// Minimal typings for dbus-native@0.15.1 (MIT), which ships none. Only the
// surface the at-spi backend uses is declared.
declare module "dbus-native" {
  export interface DbusMessage {
    destination: string;
    path: string;
    interface: string;
    member: string;
    signature?: string;
    body?: unknown[];
  }

  // The raw wire message shape dbus-native parses and emits. Only the fields
  // the at-spi backend reads or writes are declared; `type` is the D-Bus
  // message type (4 = signal).
  export interface DbusWireMessage {
    type?: number;
    serial?: number;
    sender?: string;
    destination?: string;
    path?: string;
    interface?: string;
    member?: string;
    signature?: string;
    body?: unknown[];
  }

  export interface DbusConnection {
    end(): void;
    message(msg: DbusWireMessage): void;
    on(event: "message", listener: (msg: DbusWireMessage) => void): void;
    removeListener(event: "message", listener: (msg: DbusWireMessage) => void): void;
  }

  export interface DbusBus {
    connection: DbusConnection;
    invoke(message: DbusMessage, callback: (err: unknown, ...results: unknown[]) => void): void;
  }

  export function sessionBus(): DbusBus;
  export function createClient(options: { busAddress: string; direct?: boolean }): DbusBus;

  const dbus: {
    sessionBus: typeof sessionBus;
    createClient: typeof createClient;
  };
  export default dbus;
}
