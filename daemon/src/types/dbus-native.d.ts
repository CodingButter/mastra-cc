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

  export interface DbusConnection {
    end(): void;
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
