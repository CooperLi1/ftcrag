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
    sourceFragments?: { title: string; url: string | null; excerpt: string }[];
}

interface Conversation {
    id: string;
    title: string;
    messages: MessageType[];
    updatedAt: number;
}

const STORAGE_KEY = "ftc-chat-conversations";
const RAG_CONTEXT_START = "<<RAG_CONTEXT_JSON>>";
const RAG_CONTEXT_END = "<<END_RAG_CONTEXT_JSON>>";

function parseAssistantPayload(raw: string): {
    content: string;
    sourceFragments?: { title: string; url: string | null; excerpt: string }[];
} {
    const start = raw.indexOf(RAG_CONTEXT_START);
    if (start === -1) return { content: raw };

    const end = raw.indexOf(RAG_CONTEXT_END, start + RAG_CONTEXT_START.length);
    if (end === -1) {
        return { content: raw.slice(0, start) };
    }

    const content = raw.slice(0, start);
    const jsonText = raw.slice(start + RAG_CONTEXT_START.length, end);

    try {
        const parsed = JSON.parse(jsonText) as {
            sourceFragments?: { title?: string; url?: string | null; excerpt?: string }[];
        };
        const sourceFragments = Array.isArray(parsed.sourceFragments)
            ? parsed.sourceFragments
                .filter((item) => typeof item?.excerpt === "string")
                .map((item) => ({
                    title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : "Source",
                    url: typeof item.url === "string" && item.url.trim() ? item.url.trim() : null,
                    excerpt: item.excerpt ?? "",
                }))
            : [];

        return {
            content,
            sourceFragments: sourceFragments.length > 0 ? sourceFragments : undefined,
        };
    } catch {
        return { content };
    }
}

export function ChatInterface() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

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
        if (activeChat && activeChat.messages.length === 0) {
            return;
        }

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
            const initialChat: Conversation = {
                id: crypto.randomUUID(),
                title: "New Chat",
                messages: [],
                updatedAt: Date.now(),
            };
            setConversations([initialChat]);
            setActiveConversationId(initialChat.id);
        }
    }, [isLoaded, conversations.length]);

    const activeChat = conversations.find(c => c.id === activeConversationId) || (conversations.length > 0 ? conversations[0] : null);

    const handleSelectConversation = (id: string) => {
        setActiveConversationId(id);
        if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
            setIsSidebarOpen(false);
        }
    };

    const handleDeleteConversation = (id: string) => {
        const chatToDelete = conversations.find((c) => c.id === id);
        if (!chatToDelete) return;
        setDeleteTarget({ id: chatToDelete.id, title: chatToDelete.title || "this chat" });
    };

    const confirmDeleteConversation = () => {
        if (!deleteTarget) return;
        const deletingId = deleteTarget.id;
        const nextConversations = conversations.filter((c) => c.id !== deletingId);
        setConversations(nextConversations);
        setDeleteTarget(null);

        if (nextConversations.length === 0) {
            setActiveConversationId("");
            return;
        }

        if (activeConversationId === deletingId) {
            setActiveConversationId(nextConversations[0].id);
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
                    messages: [...updatedMessages, { role: "assistant", content: "" }],
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

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = new TextDecoder().decode(value);
                    assistantContent += chunk;

                    setConversations(prev => prev.map(c =>
                        c.id === activeChat.id
                            ? {
                                ...c,
                                messages: c.messages.map((m, i) => {
                                    if (i !== c.messages.length - 1) return m;
                                    const parsed = parseAssistantPayload(assistantContent);
                                    return { ...m, content: parsed.content, sourceFragments: parsed.sourceFragments };
                                }),
                            }
                            : c
                    ));
                }
            }
        } catch (error) {
            console.error(error);
            setConversations(prev => prev.map(c =>
                c.id === activeChat.id
                    ? {
                        ...c,
                        messages: c.messages.map((m, i) =>
                            i === c.messages.length - 1 && m.role === "assistant" && !m.content
                                ? { ...m, content: "I ran into an error while generating a response. Please try again." }
                                : m
                        ),
                    }
                    : c
            ));
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
                onDelete={handleDeleteConversation}
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
                            <Message
                                key={i}
                                message={msg}
                                loadingLabel={
                                    isLoading && msg.role === "assistant" && i === (activeChat.messages.length - 1)
                                        ? "Thinking..."
                                        : undefined
                                }
                            />
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
            {deleteTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <button
                        onClick={() => setDeleteTarget(null)}
                        aria-label="Close delete confirmation"
                        className="absolute inset-0 bg-black/40"
                    />
                    <div className="relative w-full max-w-md rounded-2xl border border-border-custom bg-background p-5 shadow-2xl space-y-4">
                        <h2 className="text-lg font-semibold">Delete chat?</h2>
                        <p className="text-sm text-text-muted">
                            This will permanently delete <span className="font-medium text-foreground">&quot;{deleteTarget.title}&quot;</span>.
                            This action cannot be undone.
                        </p>
                        <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                                onClick={() => setDeleteTarget(null)}
                                className="rounded-lg border border-border-custom px-3 py-2 text-sm hover:bg-message-user/80"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDeleteConversation}
                                className="rounded-lg bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
