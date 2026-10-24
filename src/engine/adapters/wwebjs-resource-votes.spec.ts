import type { Client } from 'whatsapp-web.js';
import { registerWwebjsMessageEvents } from './wwebjs-message-events';
import type { WwebjsEngineHost } from './wwebjs-host';

describe('WhatsApp Web resource menu votes', () => {
  function build() {
    const handlers = new Map<string, (vote: unknown) => void>();
    const onMessage = jest.fn();
    const host = {
      getSelfWid: () => '100@c.us',
      getCallbacks: () => ({ onMessage }),
      logger: { error: jest.fn() },
    } as unknown as WwebjsEngineHost;
    registerWwebjsMessageEvents(
      { on: (name: string, handler: (vote: unknown) => void) => handlers.set(name, handler) } as unknown as Client,
      host,
    );
    return { vote: handlers.get('vote_update')!, onMessage };
  }
  const input = {
    selectedOptions: [{ name: 'કોર્સ PDF' }],
    voter: '200@c.us',
    interractedAtTs: 1700000000123,
    parentMessage: { fromMe: true, to: '200@c.us', from: '100@c.us', id: { _serialized: 'menu' } },
  };
  it('projects a single selected label with a valid timestamp into the inbound automation path', () => {
    const { vote, onMessage } = build();
    vote(input);
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'કોર્સ PDF',
        chatId: '200@c.us',
        fromMe: false,
        timestamp: 1700000000,
      }),
    );
  });
  it("ignores votes on other people's polls and withdrawn or multiple selections", () => {
    const { vote, onMessage } = build();
    vote({ ...input, parentMessage: { ...input.parentMessage, fromMe: false } });
    vote({ ...input, selectedOptions: [] });
    vote({ ...input, selectedOptions: [{ name: 'PDF' }, { name: 'Video' }] });
    expect(onMessage).not.toHaveBeenCalled();
  });
});
