// Sends three requests to a running daemon and prints each response line as it
// arrived: an unknown method, an unknown element, and an effect without the grant.
import net from "node:net";
const [sock, digest] = process.argv.slice(2);
const c = net.connect(sock);
let buf = "", n = 0;
const reqs = [
  { method: "noSuchMethod", params: {} },
  { method: "attestElement", params: { id: "el-000000000000" } },
  { method: "activateElement", params: { id: "el-000000000000" } },
];
c.on("data", (d) => {
  buf += d; let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    const m = JSON.parse(line);
    if (m.type === "hello") reqs.forEach((r, k) => c.write(JSON.stringify({ type: "request", id: k + 1, ...r }) + "\n"));
    else { console.log(`${reqs[m.id - 1].method}: ${line}`); if (++n === reqs.length) c.end(); }
  }
});
c.write(JSON.stringify({ type: "hello", digest }) + "\n");
