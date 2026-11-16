import { createRoot } from "react-dom/client";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource/alegreya-sans/400.css";
import "@fontsource/alegreya-sans/500.css";
import "@fontsource/alegreya-sans/700.css";
import "./tokens.css";
import "./styles.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(<App />);
