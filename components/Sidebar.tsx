"use client";

import { Plus, MessageSquare, X } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

interface SidebarProps {
    conversations: { id: string; title: string }[];
    activeId: string;
    onSelect: (id: string) => void;
    onNewChat: () => void;
    isOpen: boolean;
    onClose: () => void;
}

function SidebarContent({
    conversations,
    activeId,
    onSelect,
    onNewChat,
    onClose,
    mobile,
}: {
    conversations: { id: string; title: string }[];
    activeId: string;
    onSelect: (id: string) => void;
    onNewChat: () => void;
    onClose: () => void;
    mobile: boolean;
}) {
    return (
        <>
            <div className="p-3 border-b border-border-custom/80">
                <div className="flex items-center gap-2">
                    <button
                        onClick={onNewChat}
                        className="flex items-center gap-2 w-full rounded-xl px-3 py-2.5 hover:bg-message-user transition-colors border border-border-custom/80 font-medium text-sm"
                    >
                        <Plus className="w-4 h-4" />
                        New Chat
                    </button>
                    {mobile && (
                        <button
                            onClick={onClose}
                            aria-label="Close sidebar"
                            className="md:hidden rounded-lg p-2 hover:bg-message-user/80 transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            <nav className="flex-1 overflow-y-auto p-2 space-y-1.5">
                <div className="text-[10px] uppercase tracking-widest text-text-muted px-3 py-3 font-semibold">Recent</div>
                {conversations.map((chat) => (
                    <button
                        key={chat.id}
                        onClick={() => onSelect(chat.id)}
                        className={`flex items-center gap-2 w-full px-3 py-2.5 rounded-xl transition-colors text-sm text-left ${activeId === chat.id
                            ? "bg-message-user text-foreground"
                            : "text-text-muted hover:bg-message-user/80 hover:text-foreground"
                            }`}
                    >
                        <MessageSquare className="w-4 h-4 opacity-50 flex-shrink-0" />
                        <span className="truncate">{chat.title}</span>
                    </button>
                ))}
            </nav>

            <div className="p-3 border-t border-border-custom/80 flex items-center justify-between">
                <span className="text-xs font-medium text-text-muted">Theme</span>
                <ThemeToggle />
            </div>
        </>
    );
}

export function Sidebar({ conversations, activeId, onSelect, onNewChat, isOpen, onClose }: SidebarProps) {
    return (
        <>
            <div className={`hidden md:flex transition-[width] duration-200 ${isOpen ? "w-72" : "w-0"}`}>
                <aside className="h-full w-72 bg-sidebar border-r border-border-custom/80 flex-col overflow-hidden">
                    <SidebarContent
                        conversations={conversations}
                        activeId={activeId}
                        onSelect={onSelect}
                        onNewChat={onNewChat}
                        onClose={onClose}
                        mobile={false}
                    />
                </aside>
            </div>

            <div className={`fixed inset-0 z-40 md:hidden ${isOpen ? "pointer-events-auto" : "pointer-events-none"}`}>
                <button
                    onClick={onClose}
                    aria-label="Close sidebar backdrop"
                    className={`absolute inset-0 bg-black/35 transition-opacity ${isOpen ? "opacity-100" : "opacity-0"}`}
                />
                <aside className={`relative h-full w-72 bg-sidebar border-r border-border-custom/80 flex flex-col transition-transform duration-200 ${isOpen ? "translate-x-0" : "-translate-x-full"}`}>
                    <SidebarContent
                        conversations={conversations}
                        activeId={activeId}
                        onSelect={onSelect}
                        onNewChat={onNewChat}
                        onClose={onClose}
                        mobile
                    />
                </aside>
            </div>
        </>
    );
}
