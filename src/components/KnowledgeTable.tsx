import React, { useState } from "react";
import { KnowledgeItem } from "../types";
import { Plus, ArrowLeft, Search, MoreHorizontal, Play, Sparkles } from "lucide-react";

interface KnowledgeTableProps {
  items: KnowledgeItem[];
  onAddItem: () => void;
  onSelectItem: (item: KnowledgeItem) => void;
}

export const KnowledgeTable: React.FC<KnowledgeTableProps> = ({
  items,
  onAddItem,
  onSelectItem,
}) => {
  const [filter, setFilter] = useState("");
  const [selectedNote, setSelectedNote] = useState<KnowledgeItem | null>(null);

  const gradients = [
    "from-lime-300 via-yellow-200 to-rose-300",
    "from-sky-300 via-indigo-200 to-purple-300",
    "from-emerald-300 via-teal-200 to-blue-300",
    "from-rose-300 via-pink-200 to-amber-200",
  ];

  const filtered = items.filter(
    (item) =>
      item.subject.toLowerCase().includes(filter.toLowerCase()) ||
      item.summary.toLowerCase().includes(filter.toLowerCase())
  );

  // If a note is selected, show the detail view matching Attachment 1!
  if (selectedNote) {
    return (
      <div className="w-full max-w-4xl mx-auto space-y-8 animate-fade-in">
        {/* Top Back and Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSelectedNote(null)}
            className="w-9 h-9 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSelectItem(selectedNote)}
              className="w-9 h-9 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 transition-colors"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Hero Card matching Attachment 1 */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-8 pt-4">
          {/* Rounded square artwork */}
          <div
            className={`w-48 h-48 sm:w-56 sm:h-56 rounded-3xl bg-gradient-to-tr ${
              selectedNote.coverGradient || "from-lime-300 via-amber-200 to-rose-300"
            } shadow-md shrink-0 flex items-center justify-center`}
          >
            <Sparkles className="w-10 h-10 text-white/50" />
          </div>

          <div className="flex-1 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">
                  {selectedNote.subject}
                </h1>
                <p className="text-xs text-slate-400 mt-1">
                  {selectedNote.domain || "Knowledge"} • {selectedNote.itemCount || 1} note • {selectedNote.status}
                </p>
              </div>

              <button
                onClick={() => onSelectItem(selectedNote)}
                className="w-10 h-10 rounded-full bg-slate-950 text-white dark:bg-white dark:text-slate-950 flex items-center justify-center shadow-md hover:scale-105 transition-all"
              >
                <Play className="w-4 h-4 fill-current ml-0.5" />
              </button>
            </div>

            <button
              onClick={onAddItem}
              className="w-full py-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors flex items-center justify-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add entry</span>
            </button>

            {/* Note Summary */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
                {selectedNote.summary}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Grid view matching Attachment 2!
  return (
    <div className="w-full max-w-5xl mx-auto space-y-8 animate-fade-in">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-line">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">
            Notes & Vault
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {items.length} mental models and project records
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-raised rounded-full px-3 py-1.5 text-xs text-slate-500">
            <Search className="w-3.5 h-3.5 mr-1.5" />
            <input
              type="text"
              placeholder="Search notes..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-transparent focus:outline-none text-ink w-28 sm:w-36"
            />
          </div>

          <button
            onClick={onAddItem}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary hover:opacity-90 text-white text-xs font-semibold shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Note</span>
          </button>
        </div>
      </div>

      {/* Grid of Rounded Cards matching Attachment 2 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
        {filtered.map((item, idx) => {
          const grad = item.coverGradient || gradients[idx % gradients.length];
          return (
            <div
              key={item.id}
              onClick={() => setSelectedNote(item)}
              className="group cursor-pointer space-y-2.5"
            >
              {/* Rounded Square Artwork */}
              <div
                className={`w-full aspect-square rounded-3xl bg-gradient-to-tr ${grad} shadow-xs group-hover:shadow-md group-hover:scale-[1.02] transition-all relative overflow-hidden`}
              >
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors"></div>
              </div>

              {/* Title & Metadata underneath */}
              <div className="px-1">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-ink truncate">
                    {item.subject}
                  </h4>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectItem(item);
                    }}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 truncate">
                  {item.domain || "Knowledge"} • {item.status}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
