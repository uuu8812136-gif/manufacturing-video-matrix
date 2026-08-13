declare module 'tar-stream' {
  import type { Readable, Writable } from 'node:stream';

  export interface Header {
    name: string;
    size: number;
    mode?: number;
  }

  export interface Pack extends Readable {
    entry(
      header: Partial<Header> & Pick<Header, 'name'>,
      callback?: (error?: Error | null) => void,
    ): Writable;
    entry(
      header: Partial<Header> & Pick<Header, 'name'>,
      buffer: Buffer,
      callback?: (error?: Error | null) => void,
    ): Writable;
    finalize(): void;
  }

  export interface Extract extends Writable {
    on(
      event: 'entry',
      listener: (header: Header, stream: Readable, next: () => void) => void,
    ): this;
  }

  export function pack(): Pack;
  export function extract(): Extract;
}
