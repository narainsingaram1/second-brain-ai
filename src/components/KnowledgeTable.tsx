import React, { useState } from "react";
import { KnowledgeItem } from "../types";
import { Plus, Upload, Calendar as CalendarIcon, Star, Search } from "lucide-react";

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
  const [starred, setStarred] = useState<Record<string, boolean>>({ "know-1": true, "know-2": true });

  const toggleStar = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setStarred((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const filtered = items.filter(
    (item) =>
      item.subject.toLowerCase().includes(filter.toLowerCase()) ||
      item.summary.toLowerCase().includes(filter.toLowerCase())
  );

  const getStatusBadge = (status: KnowledgeItem["status"]) => {
    switch (status) {
      case "Executed":
        return "bg-blue-500/15 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 border border-blue-500/30";
      case "Synthesized":
        return "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 border border-emerald-500/30";
      case "Review":
        return "bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border border-amber-500/30";
      default:
        return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
    }
  };

  return (
    <div className="bg-slate-200/50 dark:bg-slate-900/40 rounded-4xl p-5 border border-slate-300/60 dark:border-slate-800 shadow-sm flex flex-col h-full">
      {/* Header bar matching the screenshot */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white">
            Suggested Knowledge
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Synthesized cognitive vaults & project briefs
          </p>
        </div>

        {/* Search input & Top Right Action Pills: +, Upload, Calendar */}
        <div className="flex items-center gap-2">
          <div className="relative flex items-center bg-white dark:bg-slate-800 rounded-full border border-slate-200 dark:border-slate-700 px-2.5 py-1 shadow-xs">
            <Search className="w-3 h-3 text-slate-400 mr-1.5" />
            <input
              type="text"
              placeholder="Filter vault..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="text-xs bg-transparent focus:outline-none text-slate-800 dark:text-slate-200 placeholder-slate-400 w-24 sm:w-32"
            />
          </div>

          <div className="flex items-center gap-1.5 bg-white dark:bg-slate-800 p-1 rounded-full shadow-sm border border-slate-200 dark:border-slate-700">
          <button
            onClick={onAddItem}
            title="New Knowledge Note"
            className="w-7 h-7 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            title="Import Markdown or PDF"
            className="w-7 h-7 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200"
          >
            <Upload className="w-3.5 h-3.5" />
          </button>
          <button
            title="Knowledge Calendar"
            className="w-7 h-7 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200"
          >
            <CalendarIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      </div>

      {/* Table Container */}
      <div className="bg-white dark:bg-[#141721] rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden flex-1">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800/80 text-slate-400 dark:text-slate-500 font-semibold uppercase text-[10px] tracking-wider">
                <th className="py-3 px-4 w-8"></th>
                <th className="py-3 px-4">Subject</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Start Date</th>
                <th className="py-3 px-4">End Date</th>
                <th className="py-3 px-4">Assigned User</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
              {filtered.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => onSelectItem(item)}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors group"
                >
                  <td className="py-3 px-4 text-center">
                    <button
                      onClick={(e) => toggleStar(e, item.id)}
                      className="text-slate-300 hover:text-amber-400 transition-colors"
                    >
                      <Star
                        className={`w-3.5 h-3.5 ${
                          starred[item.id]
                            ? "fill-amber-400 text-amber-400"
                            : "text-slate-300 dark:text-slate-600"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="py-3 px-4 text-slate-900 dark:text-slate-100 font-bold max-w-xs truncate">
                    {item.subject}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-block text-[10px] font-bold px-2.5 py-0.5 rounded-full ${getStatusBadge(
                        item.status
                      )}`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {item.startDate}
                  </td>
                  <td className="py-3 px-4 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {item.endDate}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      {item.assignedAvatar ? (
                        <img
                          src={item.assignedAvatar}
                          alt="User"
                          className="w-5 h-5 rounded-full object-cover shadow-sm"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-[10px] flex items-center justify-center font-bold">
                          NS
                        </div>
                      )}
                      <span className="text-slate-700 dark:text-slate-300 text-[11px] truncate">
                        {item.assignedUser || "Narain S."}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
