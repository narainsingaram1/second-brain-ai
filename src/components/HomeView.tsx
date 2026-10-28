import { BrainState, KnowledgeItem } from "../types";
import { BrainConversation } from "../hooks/useBrainConversation";
import { ChatWorkspace } from "./ChatWorkspace";

interface HomeViewProps {
  conversation: BrainConversation;
  brainState: BrainState;
  onSaveKnowledge: (item: KnowledgeItem) => void;
  onOpenSettings: () => void;
}
export function HomeView({ conversation, brainState, onSaveKnowledge, onOpenSettings }: HomeViewProps) {
  return <ChatWorkspace conversation={conversation} state={brainState} messages={brainState.chatHistory} onSaveNote={onSaveKnowledge} onOpenSettings={onOpenSettings} />;
}
