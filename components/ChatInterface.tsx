"use strict";
"use client";

import { useState, useRef, useEffect } from "react";
import { Message } from "@/components/Message";
import { ChatInput } from "@/components/ChatInput";
import { Sidebar } from "@/components/Sidebar";
import { PanelLeft } from "lucide-react";

export interface MessageType {
    role: "user" | "assistant";
    content: string;
}

interface Conversation {
    id: string;
    title: string;
    messages: MessageType[];
    updatedAt: number;
}

const STORAGE_KEY = "ftc-chat-conversations";

export function ChatInterface() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    // Load from localStorage
    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                setConversations(parsed);
                if (parsed.length > 0) {
                    setActiveConversationId(parsed[0].id);
                }
            } catch (e) {
                console.error("Failed to parse storage", e);
            }
        }
        setIsLoaded(true);
    }, []);

    // Save to localStorage
    useEffect(() => {
        if (isLoaded && conversations.length > 0) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
        }
    }, [conversations, isLoaded]);

    const createNewChat = () => {
        const newChat: Conversation = {
            id: crypto.randomUUID(),
            title: "New Chat",
            messages: [],
            updatedAt: Date.now(),
        };
        setConversations(prev => [newChat, ...prev]);
        setActiveConversationId(newChat.id);
        if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
            setIsSidebarOpen(false);
        }
    };

    // If we've loaded and there are no conversations, create one
    useEffect(() => {
        if (isLoaded && conversations.length === 0) {
            createNewChat();
        }
    }, [isLoaded, conversations.length]);

    const activeChat = conversations.find(c => c.id === activeConversationId) || (conversations.length > 0 ? conversations[0] : null);

    const handleSelectConversation = (id: string) => {
        setActiveConversationId(id);
        if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
            setIsSidebarOpen(false);
        }
    };

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [activeChat?.messages]);

    const handleSendMessage = async (content: string) => {
        if (!activeChat) return;

        const userMessage: MessageType = { role: "user", content };
        const updatedMessages = [...activeChat.messages, userMessage];

        // Update local state immediately
        setConversations(prev => prev.map(c =>
            c.id === activeChat.id
                ? {
                    ...c,
                    messages: updatedMessages,
                    title: c.messages.length === 0 ? content.slice(0, 30) : c.title,
                    updatedAt: Date.now()
                }
                : c
        ));

        setIsLoading(true);

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: updatedMessages }),
            });

            if (!response.ok) throw new Error("Failed to send message");

            const reader = response.body?.getReader();
            let assistantContent = "";

            // Add placeholder for assistant
            setConversations(prev => prev.map(c =>
                c.id === activeChat.id ? { ...c, messages: [...c.messages, { role: "assistant", content: "" }] } : c
            ));

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = new TextDecoder().decode(value);
                    assistantContent += chunk;

                    setConversations(prev => prev.map(c =>
                        c.id === activeChat.id
                            ? { ...c, messages: c.messages.map((m, i) => i === c.messages.length - 1 ? { ...m, content: assistantContent } : m) }
                            : c
                    ));
                }
            }
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex h-screen w-full bg-background overflow-hidden text-foreground selection:bg-accent selection:text-background">
            <Sidebar
                conversations={conversations.map(c => ({ id: c.id, title: c.title }))}
                activeId={activeConversationId}
                onSelect={handleSelectConversation}
                onNewChat={createNewChat}
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
            />
            <main className="flex-1 flex flex-col relative">
                <div className="h-14 border-b border-border-custom/80 bg-background/95 backdrop-blur px-3 flex items-center">
                    <button
                        onClick={() => setIsSidebarOpen(prev => !prev)}
                        className="rounded-lg p-2 hover:bg-message-user/80 transition-colors"
                        aria-label="Toggle sidebar"
                    >
                        <PanelLeft className="w-5 h-5" />
                    </button>
                </div>
                <div
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto"
                >
                    <div className="max-w-4xl mx-auto py-8 px-4 md:px-8 space-y-6">
                        {activeChat?.messages.length === 0 && (
                            <div className="h-[62vh] flex flex-col items-center justify-center text-center space-y-4">
                                <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">How can I help you today?</h1>
                                <p className="text-text-muted max-w-sm">Ask me anything about FTC or start a conversation.</p>
                            </div>
                        )}
                        {activeChat?.messages.map((msg, i) => (
                            <Message key={i} message={msg} />
                        ))}
                    </div>
                </div>
                <div className="max-w-4xl w-full mx-auto px-4 md:px-8 pb-5 pt-2 bg-background">
                    <ChatInput onSend={handleSendMessage} disabled={isLoading} />
                    <p className="text-[11px] text-center mt-3 text-text-muted">
                        FTC Chat can make mistakes. Check important info.
                    </p>
                </div>
            </main>
        </div>
    );
}
