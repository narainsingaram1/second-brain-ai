import { useSyncExternalStore } from "react";
import { lectureRecorder } from "../services/lectureRecorder";

/** The recorder's state (recordings, transcription progress, note write-ups), re-rendering on change. */
export const useLectureRecorder = () => useSyncExternalStore(lectureRecorder.subscribe, lectureRecorder.getSnapshot);
