export interface AgentMember {
  id: string;
  name: string;
  role: string;
  avatarColor: string;
  email?: string;
}

export interface InternalNote {
  id: string;
  chatId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface QuickReply {
  id: string;
  shortcut: string; // e.g. "/welcome", "/pricing"
  title: string;
  content: string;
  category?: string;
}

export interface ChatAssignment {
  chatId: string;
  agentId: string | null;
  assignedAt?: string;
  assignedBy?: string;
}

const DEFAULT_AGENTS: AgentMember[] = [
  { id: 'agent-1', name: 'Alex Johnson', role: 'Sales Lead', avatarColor: '#3b82f6', email: 'alex@company.com' },
  { id: 'agent-2', name: 'Sara Connor', role: 'Support Specialist', avatarColor: '#10b981', email: 'sara@company.com' },
  { id: 'agent-3', name: 'John Doe', role: 'Billing & Ops', avatarColor: '#8b5cf6', email: 'john@company.com' },
  { id: 'agent-me', name: 'Current User (You)', role: 'Admin / Agent', avatarColor: '#ec4899', email: 'me@company.com' },
];

const DEFAULT_QUICK_REPLIES: QuickReply[] = [
  {
    id: 'qr-1',
    shortcut: '/hello',
    title: 'Warm Welcome',
    content: 'Hello! 👋 Thanks for reaching out to us. How can our team assist you today?',
    category: 'Greetings',
  },
  {
    id: 'qr-2',
    shortcut: '/hours',
    title: 'Business Hours',
    content: 'Our team is available Monday to Friday from 9:00 AM to 6:00 PM IST. We will respond promptly during working hours.',
    category: 'General',
  },
  {
    id: 'qr-3',
    shortcut: '/pricing',
    title: 'Pricing & Plans',
    content: 'You can check our latest plans and pricing details directly on our website or reply with your exact requirements for a custom quote!',
    category: 'Sales',
  },
  {
    id: 'qr-4',
    shortcut: '/support',
    title: 'Escalate to Specialist',
    content: 'I am looping in our technical support specialist to review this issue with you right away.',
    category: 'Support',
  },
];

const STORAGE_KEYS = {
  AGENTS: 'openwa_multiagent_members',
  ASSIGNMENTS: 'openwa_multiagent_assignments',
  NOTES: 'openwa_multiagent_notes',
  QUICK_REPLIES: 'openwa_multiagent_quick_replies',
  CURRENT_AGENT_ID: 'openwa_multiagent_active_agent_id',
};

export const agentInboxStore = {
  // Agents
  getAgents(): AgentMember[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.AGENTS);
      if (!stored) {
        localStorage.setItem(STORAGE_KEYS.AGENTS, JSON.stringify(DEFAULT_AGENTS));
        return DEFAULT_AGENTS;
      }
      return JSON.parse(stored);
    } catch {
      return DEFAULT_AGENTS;
    }
  },

  getCurrentAgent(): AgentMember {
    const agents = this.getAgents();
    const activeId = localStorage.getItem(STORAGE_KEYS.CURRENT_AGENT_ID);
    const found = agents.find(a => a.id === activeId);
    return found || agents.find(a => a.id === 'agent-me') || agents[0];
  },

  setCurrentAgentId(id: string): void {
    localStorage.setItem(STORAGE_KEYS.CURRENT_AGENT_ID, id);
  },

  // Assignments: record map of chatId -> agentId
  getAssignments(): Record<string, string | null> {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.ASSIGNMENTS);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  },

  getAssignmentForChat(chatId: string): string | null {
    const map = this.getAssignments();
    return map[chatId] || null;
  },

  assignChat(chatId: string, agentId: string | null): void {
    const map = this.getAssignments();
    if (agentId) {
      map[chatId] = agentId;
    } else {
      delete map[chatId];
    }
    localStorage.setItem(STORAGE_KEYS.ASSIGNMENTS, JSON.stringify(map));
  },

  // Internal Notes: record list of notes for a chat
  getNotesForChat(chatId: string): InternalNote[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.NOTES);
      const allNotes: InternalNote[] = stored ? JSON.parse(stored) : [];
      return allNotes.filter(n => n.chatId === chatId);
    } catch {
      return [];
    }
  },

  addNote(chatId: string, content: string): InternalNote {
    const currentAgent = this.getCurrentAgent();
    const newNote: InternalNote = {
      id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      chatId,
      authorId: currentAgent.id,
      authorName: currentAgent.name,
      content: content.trim(),
      createdAt: new Date().toISOString(),
    };

    try {
      const stored = localStorage.getItem(STORAGE_KEYS.NOTES);
      const allNotes: InternalNote[] = stored ? JSON.parse(stored) : [];
      allNotes.push(newNote);
      localStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(allNotes));
    } catch {
      // Storage quota or parsing error fallback
    }

    return newNote;
  },

  deleteNote(noteId: string): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.NOTES);
      const allNotes: InternalNote[] = stored ? JSON.parse(stored) : [];
      const updated = allNotes.filter(n => n.id !== noteId);
      localStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(updated));
    } catch {
      // ignore
    }
  },

  // Quick Replies
  getQuickReplies(): QuickReply[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.QUICK_REPLIES);
      if (!stored) {
        localStorage.setItem(STORAGE_KEYS.QUICK_REPLIES, JSON.stringify(DEFAULT_QUICK_REPLIES));
        return DEFAULT_QUICK_REPLIES;
      }
      return JSON.parse(stored);
    } catch {
      return DEFAULT_QUICK_REPLIES;
    }
  },

  saveQuickReply(reply: Omit<QuickReply, 'id'> & { id?: string }): QuickReply {
    const all = this.getQuickReplies();
    if (reply.id) {
      const idx = all.findIndex(r => r.id === reply.id);
      if (idx >= 0) {
        all[idx] = { ...all[idx], ...reply };
        localStorage.setItem(STORAGE_KEYS.QUICK_REPLIES, JSON.stringify(all));
        return all[idx];
      }
    }

    const created: QuickReply = {
      ...reply,
      id: `qr_${Date.now()}`,
    };
    all.push(created);
    localStorage.setItem(STORAGE_KEYS.QUICK_REPLIES, JSON.stringify(all));
    return created;
  },

  deleteQuickReply(id: string): void {
    const all = this.getQuickReplies();
    const filtered = all.filter(r => r.id !== id);
    localStorage.setItem(STORAGE_KEYS.QUICK_REPLIES, JSON.stringify(filtered));
  },
};
