import "./meshopt-loader";
import { createRoot } from "react-dom/client";
import "../app/globals.css";
import CommercialTaxiGame from "../app/CommercialTaxiGame";

createRoot(document.getElementById("root")!).render(<CommercialTaxiGame />);
