/**
 * An incremental reader of server-sent events (`text/event-stream`): feed it text as it arrives
 * and it returns each complete event's `data` (lines joined with `\n`) and `event` name. Comments
 * and keep-alives are skipped.
 */
export interface SseEvent {
  event: string | null
  data: string
}

export class SseReader {
  private buffer = ''
  private dataLines: string[] = []
  private eventName: string | null = null

  feed(text: string): SseEvent[] {
    this.buffer += text
    const events: SseEvent[] = []
    let newline: number
    while ((newline = this.buffer.search(/\r\n|\r|\n/)) >= 0) {
      const line = this.buffer.slice(0, newline)
      const breakLength = this.buffer.startsWith('\r\n', newline) ? 2 : 1
      // A lone \r at the very end may be the first half of \r\n: wait for more.
      if (breakLength === 1 && this.buffer[newline] === '\r' && newline === this.buffer.length - 1) break
      this.buffer = this.buffer.slice(newline + breakLength)
      const event = this.line(line)
      if (event) events.push(event)
    }
    return events
  }

  /** The event still open when the stream ends (a server that does not end with a blank line). */
  end(): SseEvent[] {
    const events: SseEvent[] = []
    if (this.buffer !== '') {
      const event = this.line(this.buffer)
      if (event) events.push(event)
      this.buffer = ''
    }
    const last = this.line('')
    if (last) events.push(last)
    return events
  }

  private line(line: string): SseEvent | null {
    if (line === '') {
      if (this.dataLines.length === 0) {
        this.eventName = null
        return null
      }
      const event = { event: this.eventName, data: this.dataLines.join('\n') }
      this.dataLines = []
      this.eventName = null
      return event
    }
    if (line.startsWith(':')) return null
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') this.dataLines.push(value)
    else if (field === 'event') this.eventName = value
    return null
  }
}
