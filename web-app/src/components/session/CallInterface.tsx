import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { motion } from 'framer-motion'
import { Mic, MicOff, Video, VideoOff, PhoneOff } from 'lucide-react'

interface CallInterfaceProps {
    onEndCall: () => void
}

interface CallSignal {
    type: 'call_signal'
    signal_type: string
    data: string
}

export function CallInterface({ onEndCall }: CallInterfaceProps) {
    const [isMuted, setIsMuted] = useState(false)
    const [isVideoOff, setIsVideoOff] = useState(false)
    const [peerConnection, setPeerConnection] = useState<RTCPeerConnection | null>(null)
    const [localStream, setLocalStream] = useState<MediaStream | null>(null)
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)

    const localVideoRef = useRef<HTMLVideoElement>(null)
    const remoteVideoRef = useRef<HTMLVideoElement>(null)

    useEffect(() => {
        initializeCall()

        return () => {
            cleanup()
        }
    }, [])

    const initializeCall = async () => {
        try {
            // Get local media stream
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            })
            setLocalStream(stream)

            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream
            }

            // Create peer connection
            const pc = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            })

            // Add local tracks to peer connection
            stream.getTracks().forEach(track => {
                pc.addTrack(track, stream)
            })

            // Handle remote stream
            pc.ontrack = (event) => {
                const [remoteStream] = event.streams
                setRemoteStream(remoteStream)
                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = remoteStream
                }
            }

            // Handle ICE candidates
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    sendSignal('ice-candidate', JSON.stringify(event.candidate))
                }
            }

            setPeerConnection(pc)

            // Listen for incoming signals
            const unlisten = await listen<string>('session-message', async (event) => {
                try {
                    const msg: CallSignal = JSON.parse(event.payload)

                    if (msg.type === 'call_signal') {
                        await handleSignal(pc, msg.signal_type, msg.data)
                    }
                } catch (err) {
                    console.error('Failed to handle signal:', err)
                }
            })

            // Create and send offer
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            sendSignal('offer', JSON.stringify(offer))

            return unlisten
        } catch (err) {
            console.error('Failed to initialize call:', err)
        }
    }

    const sendSignal = async (signalType: string, data: string) => {
        try {
            await invoke('send_call_signal', {
                signalType,
                data
            })
        } catch (err) {
            console.error('Failed to send signal:', err)
        }
    }

    const handleSignal = async (pc: RTCPeerConnection, signalType: string, data: string) => {
        try {
            if (signalType === 'offer') {
                const offer = JSON.parse(data)
                await pc.setRemoteDescription(new RTCSessionDescription(offer))
                const answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                sendSignal('answer', JSON.stringify(answer))
            } else if (signalType === 'answer') {
                const answer = JSON.parse(data)
                await pc.setRemoteDescription(new RTCSessionDescription(answer))
            } else if (signalType === 'ice-candidate') {
                const candidate = JSON.parse(data)
                await pc.addIceCandidate(new RTCIceCandidate(candidate))
            }
        } catch (err) {
            console.error('Failed to handle signal:', err)
        }
    }

    const cleanup = () => {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop())
        }
        if (peerConnection) {
            peerConnection.close()
        }
    }

    const toggleMute = () => {
        if (localStream) {
            const audioTrack = localStream.getAudioTracks()[0]
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled
                setIsMuted(!audioTrack.enabled)
            }
        }
    }

    const toggleVideo = () => {
        if (localStream) {
            const videoTrack = localStream.getVideoTracks()[0]
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled
                setIsVideoOff(!videoTrack.enabled)
            }
        }
    }

    const handleEndCall = () => {
        cleanup()
        onEndCall()
    }

    return (
        <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--app-bg)' }}>
            {/* Video Area */}
            <div className="flex-1 relative bg-black">
                {/* Remote Video (Main) */}
                <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                />

                {/* Local Video (Picture-in-Picture) */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="absolute top-4 right-4 w-48 h-36 rounded-lg overflow-hidden shadow-lg border-2"
                    style={{ borderColor: 'rgba(255, 255, 255, 0.3)' }}
                >
                    <video
                        ref={localVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                    />
                    {isVideoOff && (
                        <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                            <VideoOff size={32} className="text-white opacity-50" />
                        </div>
                    )}
                </motion.div>

                {/* Connection Status */}
                {!remoteStream && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
                        <div className="text-center text-white">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
                            <p>Connecting...</p>
                        </div>
                    </div>
                )}
            </div>

            {/* Controls */}
            <div className="p-4 flex justify-center gap-4" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
                <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={toggleMute}
                    className="p-4 rounded-full transition-colors"
                    style={{
                        backgroundColor: isMuted ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 255, 255, 0.2)',
                        border: `1px solid ${isMuted ? 'rgba(239, 68, 68, 0.5)' : 'rgba(255, 255, 255, 0.3)'}`,
                        color: isMuted ? 'rgb(239, 68, 68)' : 'white'
                    }}
                >
                    {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                </motion.button>

                <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={toggleVideo}
                    className="p-4 rounded-full transition-colors"
                    style={{
                        backgroundColor: isVideoOff ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 255, 255, 0.2)',
                        border: `1px solid ${isVideoOff ? 'rgba(239, 68, 68, 0.5)' : 'rgba(255, 255, 255, 0.3)'}`,
                        color: isVideoOff ? 'rgb(239, 68, 68)' : 'white'
                    }}
                >
                    {isVideoOff ? <VideoOff size={24} /> : <Video size={24} />}
                </motion.button>

                <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleEndCall}
                    className="p-4 rounded-full transition-colors"
                    style={{
                        backgroundColor: 'rgba(239, 68, 68, 0.3)',
                        border: '1px solid rgba(239, 68, 68, 0.5)',
                        color: 'rgb(239, 68, 68)'
                    }}
                >
                    <PhoneOff size={24} />
                </motion.button>
            </div>
        </div>
    )
}
