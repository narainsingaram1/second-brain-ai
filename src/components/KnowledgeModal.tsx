import React, { useState } from "react";
import { KnowledgeItem, LifeDomain } from "../types";
import { X, Database } from "lucide-react";

interface KnowledgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: KnowledgeItem | null;
  onSave: (item: KnowledgeItem) => void;
  onDelete?: (id: string) => void;
}

export const KnowledgeModal: React.FC<KnowledgeModalProps> = ({
  isOpen,
  onClose,
  item,
  onSave,
  onDelete,
}) => {
  const [subject, setSubject] = useState(item?.subject || "");
  const [status, setStatus] = useState<KnowledgeItem["status"]>(item?.status || "Synthesized");
  const [domain, setDomain] = useState<LifeDomain>(item?.domain || "career");
  const [startDate, setStartDate] = useState(item?.startDate || new Date().toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState(item?.endDate || new Date(Date.now() + 86400000).toISOString().split("T")[0]);
  const [summary, setSummary] = useState(item?.summary || "");

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim()) return;

    const updated: KnowledgeItem = {
      id: item?.id || `know-${Date.now()}`,
      subject: subject.trim(),
      status,
      domain,
      startDate,
      endDate,
      summary: summary.trim(),
      assignedUser: item?.assignedUser || "Narain S.",
      assignedAvatar: item?.assignedAvatar || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80",
    };

    onSave(updated);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-[#141721] rounded-4xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-500" />
            <h3 className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white">
              {item ? "Knowledge Artifact" : "New Suggested Knowledge"}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Subject / Topic *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Design Sprint: Neumorphic Life OS"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-900 dark:text-slate-100 px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Execution Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-800 dark:text-slate-200 px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none"
              >
                <option value="Executed">Executed</option>
                <option value="Synthesized">Synthesized</option>
                <option value="Review">Review</option>
                <option value="Draft">Draft</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Domain
              </label>
              <select
                value={domain}
                onChange={(e) => setDomain(e.target.value as any)}
                className="w-full bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-800 dark:text-slate-200 px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none"
              >
                <option value="career">Career</option>
                <option value="learning">Learning</option>
                <option value="ai">AI Agent</option>
                <option value="health">Health</option>
                <option value="mindset">Mindset</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Start Date
              </label>
              <input
                type="text"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                End / Review Date
              </label>
              <input
                type="text"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Summary & Synthesis Notes
            </label>
            <textarea
              rows={4}
              placeholder="Key insights, reference URLs, architectural decisions..."
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full bg-slate-100 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-medium"
            />
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            {item && onDelete ? (
              <button
                type="button"
                onClick={() => {
                  onDelete(item.id);
                  onClose();
                }}
                className="text-xs font-bold text-rose-500 hover:underline"
              >
                Delete Note
              </button>
            ) : (
              <div></div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-full text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-full bg-[#0d0f14] dark:bg-white text-white dark:text-slate-900 text-xs font-bold shadow-md hover:scale-105 active:scale-95 transition-all"
              >
                Save Knowledge
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
