import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { router } from "./routes.js";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "200kb" }));
app.use(morgan("tiny"));

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api", router);

const port = process.env.API_PORT ? parseInt(process.env.API_PORT, 10) : 3001;
app.listen(3001, () => {
  console.log(`API listening on http://localhost:${port} (container port 3001)`);
});
