import { WebSocket } from "ws";
import fs from "fs";

const ws = new WebSocket("ws://119.29.193.16:25818");
let done = false;
const timer = setTimeout(() => { if (!done) { console.log("TIMEOUT"); process.exit(1); } }, 60000);

let step = 0;
let htmlChunks = [];

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.type === "auth_ok") {
    step = 1;
    console.log("Auth OK");
    // First scroll to bottom
    ws.send(JSON.stringify({ type: "command", id: "s1", action: "scroll", x: 0, y: 5000 }));
  }

  if (msg.type === "result" && msg.id === "s1") {
    step = 2;
    console.log("Scroll 1 done");
    // Wait for virtual scroll to render
    setTimeout(() => {
      // Scroll again to trigger more
      ws.send(JSON.stringify({ type: "command", id: "s2", action: "scroll", x: 0, y: 10000 }));
    }, 1500);
  }

  if (msg.type === "result" && msg.id === "s2") {
    step = 3;
    console.log("Scroll 2 done");
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "command", id: "s3", action: "scroll", x: 0, y: 15000 }));
    }, 1500);
  }

  if (msg.type === "result" && msg.id === "s3") {
    step = 4;
    console.log("Scroll 3 done");
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "command", id: "s4", action: "scroll", x: 0, y: 20000 }));
    }, 1500);
  }

  if (msg.type === "result" && msg.id === "s4") {
    step = 5;
    console.log("Scroll 4 done");
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "command", id: "s5", action: "scroll", x: 0, y: 30000 }));
    }, 1500);
  }

  if (msg.type === "result" && msg.id === "s5") {
    step = 6;
    console.log("Scroll 5 done, fetching HTML...");
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "command", id: "html", action: "get_html", selector: "body" }));
    }, 2000);
  }

  if (msg.type === "result" && msg.id === "html") {
    if (msg.data && msg.data.html) {
      fs.writeFileSync("/tmp/shotlab2-full.html", msg.data.html);
      console.log("HTML saved:", msg.data.html.length);
    } else {
      console.log("No HTML data");
    }
    done = true;
    clearTimeout(timer);
    ws.close();
    process.exit(0);
  }
});
