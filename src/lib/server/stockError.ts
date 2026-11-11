/** A stock data request that failed, with the HTTP status to answer the browser with. */
export class StockError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}
