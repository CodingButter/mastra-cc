export interface MockDaemon {
    socketPath?: string;
    url?: string;
    close(): void;
}
export declare function mockSocketDaemon(digest: string): Promise<MockDaemon>;
export declare function mockWebSocketDaemon(digest: string): Promise<MockDaemon>;
