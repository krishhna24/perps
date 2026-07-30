import EventEmitter from "events";

export interface TopOfBook {
  a: [string, string];
  b: [string, string];
}

export type IndexPrice = string;

const bus = new EventEmitter();

export function emitTopOfBook(top: TopOfBook): void {
  bus.emit("top", top);
}

export function emitIndexPrice(index: IndexPrice): void {
  bus.emit("index", index);
}

const NO_BOOK: TopOfBook = { a: ["0", "0"], b: ["0", "0"] };

export default function onMarketDataUpdate(
  handler: (data: { top: TopOfBook; index: IndexPrice }) => void,
): void {
  let latestTop: TopOfBook | null = null;
  let latestIndex: IndexPrice | null = null;

  bus.on("top", (top: TopOfBook) => {
    latestTop = top;
    if (latestIndex !== null) {
      handler({ top, index: latestIndex });
    }
  });

  bus.on("index", (index: IndexPrice) => {
    latestIndex = index;
    handler({ top: latestTop ?? NO_BOOK, index });
  });
}
