// M1 Phase 1 placeholder: the transport package exists so the workspace pipelines
// have a real subject. The socket client - the one daemon client, B5 - lands in
// Phase 3. What is here already true: the socket path is derived, never guessed.
export const SOCKET_DIRNAME = "mastra-cc";
export const SOCKET_FILENAME = "daemon.sock";

export function socketPath(runtimeDir: string): string {
  if (runtimeDir.length === 0) {
    throw new Error("transport: runtimeDir must not be empty");
  }
  return `${runtimeDir}/${SOCKET_DIRNAME}/${SOCKET_FILENAME}`;
}
