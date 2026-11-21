import { BridgeService } from "../lib/bridge/service.js";
const b = new BridgeService({ dshWebUrl: "http://127.0.0.1:64365" });
const s = await b.status();
console.log("STATUS", JSON.stringify({ running: s.running, pid: s.pid, port: s.port, mode: s.mode, dshReady: s.dshReady, role: s.role, ownerQQ: s.ownerQQ, tokenPresent: s.consoleTokenPresent, groups: s.allowGroups, next: s.nextFireText, activity: s.activity?.length }, null, 1));
console.log("SESSIONS", JSON.stringify(b.readSessions()));
const tail = b.readTail("bridge", 3);
console.log("LOG", tail.ok, tail.size, JSON.stringify(tail.lines));
console.log("LOGFILES", JSON.stringify(b.listLogs().map(x => [x.name, x.size])));
console.log("NODE", b.resolveNode());
