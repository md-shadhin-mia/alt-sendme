import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Send, Paperclip } from 'lucide-react'

interface Message {
    from: 'me' | 'peer'
    content: string
    timestamp: Date
}

interface MessengerProps {
    messages: Message[]
    onSendMessage: (content: string) => void
}

export function Messenger({ messages, onSendMessage }: MessengerProps) {
    const [inputValue, setInputValue] = useState('')
    const messagesEndRef = useRef<HTMLDivElement>(null)

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }

    useEffect(() => {
        scrollToBottom()
    }, [messages])

    const handleSend = () => {
        if (inputValue.trim()) {
            onSendMessage(inputValue)
            setInputValue('')
        }
    }

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }

    return (
        <div className="h-full flex flex-col">
            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-center">
                        <div className="opacity-50">
                            <p className="text-lg mb-2">No messages yet</p>
                            <p className="text-sm">Start a conversation!</p>
                        </div>
                    </div>
                ) : (
                    messages.map((msg, idx) => (
                        <motion.div
                            key={idx}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`flex ${msg.from === 'me' ? 'justify-end' : 'justify-start'}`}
                        >
                            <div
                                className={`max-w-[70%] rounded-lg px-4 py-2 ${msg.from === 'me'
                                        ? 'rounded-br-none'
                                        : 'rounded-bl-none'
                                    }`}
                                style={{
                                    backgroundColor: msg.from === 'me'
                                        ? 'rgba(59, 130, 246, 0.2)'
                                        : 'rgba(255, 255, 255, 0.1)',
                                    border: `1px solid ${msg.from === 'me'
                                        ? 'rgba(59, 130, 246, 0.3)'
                                        : 'rgba(255, 255, 255, 0.2)'}`,
                                }}
                            >
                                <p className="text-sm break-words">{msg.content}</p>
                                <p className="text-xs opacity-50 mt-1">
                                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                            </div>
                        </motion.div>
                    ))
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="border-t p-4" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}>
                <div className="flex gap-2">
                    <button
                        className="p-2 rounded-lg transition-colors hover:bg-opacity-80"
                        style={{
                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                            border: '1px solid rgba(255, 255, 255, 0.2)'
                        }}
                        title="Attach file"
                    >
                        <Paperclip size={20} />
                    </button>
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Type a message..."
                        className="flex-1 px-4 py-2 rounded-lg outline-none"
                        style={{
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            color: 'inherit'
                        }}
                    />
                    <button
                        onClick={handleSend}
                        disabled={!inputValue.trim()}
                        className="p-2 rounded-lg transition-colors"
                        style={{
                            backgroundColor: inputValue.trim()
                                ? 'rgba(59, 130, 246, 0.2)'
                                : 'rgba(100, 100, 100, 0.2)',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            color: inputValue.trim() ? 'rgb(59, 130, 246)' : 'rgba(255, 255, 255, 0.3)',
                            cursor: inputValue.trim() ? 'pointer' : 'not-allowed'
                        }}
                    >
                        <Send size={20} />
                    </button>
                </div>
            </div>
        </div>
    )
}
