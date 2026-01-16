import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Messenger } from './Messenger'
import { CallInterface } from './CallInterface'
import { motion } from 'framer-motion'

interface SessionViewProps {
    ticket?: string
    isHost: boolean
    onExit: () => void
}

interface SessionMessage {
    type: 'text' | 'file_offer' | 'file_accept' | 'call_signal'
    content?: string
    name?: string
    size?: number
    hash?: string
    signal_type?: string
    data?: string
}

export function SessionView({ ticket, isHost, onExit }: SessionViewProps) {
    const [isConnected, setIsConnected] = useState(false)
    const [isConnecting, setIsConnecting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [messages, setMessages] = useState<Array<{ from: 'me' | 'peer', content: string, timestamp: Date }>>([])
    const [inCall, setInCall] = useState(false)
    const [incomingCall, setIncomingCall] = useState(false)
    const hasInitialized = useRef(false)

    useEffect(() => {
        if (hasInitialized.current) return
        hasInitialized.current = true

        const initSession = async () => {
            setIsConnecting(true)
            try {
                if (isHost) {
                    // Already started session, just wait for connection
                    setIsConnected(true)
                } else {
                    // Connect to session
                    await invoke('connect_session', { ticket })
                }
            } catch (err) {
                setError(err as string)
                console.error('Session error:', err)
            } finally {
                setIsConnecting(false)
            }
        }

        // Listen for session events
        const setupListeners = async () => {
            const unlistenConnected = await listen('session-connected', () => {
                setIsConnected(true)
                setIsConnecting(false)
            })

            const unlistenMessage = await listen<string>('session-message', (event) => {
                try {
                    const msg: SessionMessage = JSON.parse(event.payload)

                    if (msg.type === 'text') {
                        setMessages(prev => [...prev, {
                            from: 'peer',
                            content: msg.content || '',
                            timestamp: new Date()
                        }])
                    } else if (msg.type === 'call_signal') {
                        if (msg.signal_type === 'offer') {
                            setIncomingCall(true)
                        }
                    }
                } catch (err) {
                    console.error('Failed to parse message:', err)
                }
            })

            return () => {
                unlistenConnected()
                unlistenMessage()
            }
        }

        initSession()
        const cleanup = setupListeners()

        return () => {
            cleanup.then(fn => fn())
            // Stop session on unmount
            invoke('stop_session').catch(console.error)
        }
    }, [ticket, isHost])

    const sendMessage = async (content: string) => {
        try {
            await invoke('send_session_message', { message: content })
            setMessages(prev => [...prev, {
                from: 'me',
                content,
                timestamp: new Date()
            }])
        } catch (err) {
            console.error('Failed to send message:', err)
        }
    }

    const startCall = async () => {
        setInCall(true)
    }

    const acceptCall = () => {
        setIncomingCall(false)
        setInCall(true)
    }

    const endCall = () => {
        setInCall(false)
        setIncomingCall(false)
    }

    const handleExit = async () => {
        try {
            await invoke('stop_session')
        } catch (err) {
            console.error('Failed to stop session:', err)
        }
        onExit()
    }

    if (error) {
        return (
            <div className="p-8 text-center">
                <div className="text-red-500 mb-4">Error: {error}</div>
                <button
                    onClick={handleExit}
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                    Back
                </button>
            </div>
        )
    }

    if (isConnecting) {
        return (
            <div className="p-8 text-center">
                <div className="text-lg mb-4">Connecting to session...</div>
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
            </div>
        )
    }

    if (!isConnected) {
        return (
            <div className="p-8 text-center">
                <div className="text-lg mb-4">Waiting for peer to connect...</div>
                <div className="animate-pulse text-sm opacity-70">Share your ticket with the other person</div>
            </div>
        )
    }

    return (
        <div className="h-screen flex flex-col" style={{ backgroundColor: 'var(--app-bg)', color: 'var(--app-bg-fg)' }}>
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}>
                <h2 className="text-xl font-semibold">Session Active</h2>
                <div className="flex gap-2">
                    <button
                        onClick={startCall}
                        disabled={inCall}
                        className="px-4 py-2 rounded transition-colors"
                        style={{
                            backgroundColor: inCall ? 'rgba(100, 100, 100, 0.3)' : 'rgba(34, 197, 94, 0.2)',
                            color: inCall ? 'rgba(255, 255, 255, 0.5)' : 'rgb(34, 197, 94)',
                            border: '1px solid rgba(34, 197, 94, 0.3)'
                        }}
                    >
                        {inCall ? 'In Call' : 'Start Call'}
                    </button>
                    <button
                        onClick={handleExit}
                        className="px-4 py-2 rounded transition-colors"
                        style={{
                            backgroundColor: 'rgba(239, 68, 68, 0.2)',
                            color: 'rgb(239, 68, 68)',
                            border: '1px solid rgba(239, 68, 68, 0.3)'
                        }}
                    >
                        Exit Session
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Messenger */}
                <div className={`${inCall ? 'w-1/2' : 'w-full'} transition-all duration-300`}>
                    <Messenger messages={messages} onSendMessage={sendMessage} />
                </div>

                {/* Call Interface */}
                {inCall && (
                    <motion.div
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: '50%', opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        className="border-l"
                        style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}
                    >
                        <CallInterface onEndCall={endCall} />
                    </motion.div>
                )}
            </div>

            {/* Incoming Call Modal */}
            {incomingCall && (
                <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="p-8 rounded-lg shadow-xl"
                        style={{ backgroundColor: 'var(--app-main-view)' }}
                    >
                        <h3 className="text-xl font-semibold mb-4">Incoming Call</h3>
                        <div className="flex gap-4">
                            <button
                                onClick={acceptCall}
                                className="px-6 py-3 rounded-lg transition-colors"
                                style={{
                                    backgroundColor: 'rgba(34, 197, 94, 0.2)',
                                    color: 'rgb(34, 197, 94)',
                                    border: '1px solid rgba(34, 197, 94, 0.3)'
                                }}
                            >
                                Accept
                            </button>
                            <button
                                onClick={() => setIncomingCall(false)}
                                className="px-6 py-3 rounded-lg transition-colors"
                                style={{
                                    backgroundColor: 'rgba(239, 68, 68, 0.2)',
                                    color: 'rgb(239, 68, 68)',
                                    border: '1px solid rgba(239, 68, 68, 0.3)'
                                }}
                            >
                                Decline
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    )
}
