import { useState } from "react";
import DevelopmentImage from "./DevelopmentImage";
import NextBitstreamDesign from "./NextBitstreamDesign";

// Both views stay mounted so drafts and in-flight state survive Switch cycles.
export default function App() {
  const [mode, setMode] = useState<"image" | "next">("image");
  const [returnKey, setReturnKey] = useState("");
  return <>
    <div hidden={mode !== "image"}>
      <DevelopmentImage onSwitch={key => { setReturnKey(key); setMode("next"); }} />
    </div>
    <div hidden={mode !== "next"}>
      <NextBitstreamDesign returnKey={returnKey} hidden={mode !== "next"} onReturned={() => setMode("image")} />
    </div>
  </>;
}
