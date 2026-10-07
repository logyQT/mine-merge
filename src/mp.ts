// MQTT transport for PvP duels — ported from legacy app.js lines 379–404
// (BROKERS/pub/sub/loadMqtt/mqConnect) minus the deleted IN_PLAY guard.
//
// Platform gating (PLAN Phase 5.3): createNet() is only called for non-YT
// builds (compile-time `__PLATFORM__ !== 'yt'` in app.ts), so the CDN and
// wss:// strings are tree-shaken out of dist/yt — Playables' CSP forbids
// external requests (grep gate in the verification steps).

const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081',
];

const NS = 'kopalnia-pvp-v1/';

/** Message shape on the wire (legacy pub/sub payloads). */
export interface MpMsg {
  t?: string;
  from?: string;
  to?: string | undefined; // explicit undefined is dropped by JSON.stringify (legacy)
  room?: string;
  host?: boolean;
  name?: string;
  seed?: number;
  a?: Array<{ L: number; am: number; hm: number }>;
  pw?: { fire: number; slow: number; weak: number };
}

interface MqttClient {
  publish(topic: string, payload: string): void;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  end(force?: boolean): void;
  on(event: string, cb: (...args: never[]) => void): void;
}

interface MqttLib {
  connect(url: string, opts: Record<string, unknown>): MqttClient;
}

export interface Net {
  /** Client id, (re)generated on every connect — legacy mpPrep behavior. */
  readonly id: string;
  /** Loads the CDN library (legacy loadMqtt). false → not available. */
  loadLibrary(): Promise<boolean>;
  /** Broker failover (legacy mqConnect). false → all brokers failed. */
  connect(): Promise<boolean>;
  close(): void;
  connected(): boolean;
  pub(topic: string, o: Omit<MpMsg, 'from'>): void;
  sub(topic: string, fn: (d: MpMsg) => void): void;
  unsubscribe(topic: string): void;
}

export function createNet(log: (t: string) => void): Net {
  let id = '';
  let client: MqttClient | null = null;
  const subs: Record<string, (d: MpMsg) => void> = {};

  function loadLibrary(): Promise<boolean> {
    return new Promise((res) => {
      const w = window as unknown as { mqtt?: MqttLib };
      if (w.mqtt) {
        res(true);
        return;
      }
      const sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/mqtt@5/dist/mqtt.min.js';
      sc.onload = () => res(true);
      sc.onerror = () => res(false);
      document.head.appendChild(sc);
    });
  }

  function mqConnect(): Promise<boolean> {
    return new Promise((res) => {
      let i = 0;
      const next = (): void => {
        if (i >= BROKERS.length) {
          res(false);
          return;
        }
        const url = BROKERS[i++];
        log('Łączę z serwerem: ' + url);
        let done = false;
        const lib = (window as unknown as { mqtt: MqttLib }).mqtt;
        const c = lib.connect(url, { clientId: id, clean: true, connectTimeout: 6000, reconnectPeriod: 0 });
        const fail = (): void => {
          if (done) return;
          done = true;
          clearTimeout(to);
          try {
            c.end(true);
          } catch {
            // connection already gone
          }
          next();
        };
        const to = setTimeout(fail, 7000);
        c.on('connect', () => {
          if (done) return;
          done = true;
          clearTimeout(to);
          log('Serwer OK');
          c.on('message', ((t: string, pl: unknown) => {
            let d: MpMsg | null = null;
            try {
              d = JSON.parse(String(pl)) as MpMsg;
            } catch {
              return;
            }
            if (!d || d.from === id) return;
            const f = subs[t];
            if (f) f(d);
          }) as (...args: never[]) => void);
          client = c;
          res(true);
        });
        c.on('error', ((e: unknown) => {
          const err = e as { message?: string } | null;
          log('Błąd serwera: ' + (err?.message ?? String(e)));
          fail();
        }) as (...args: never[]) => void);
      };
      next();
    });
  }

  return {
    get id() {
      return id;
    },
    async loadLibrary() {
      return loadLibrary();
    },
    async connect() {
      id = 'k' + Math.random().toString(36).slice(2, 10); // legacy mpPrep id
      return mqConnect();
    },
    close() {
      try {
        client?.end(false);
      } catch {
        // already gone
      }
      client = null;
      for (const k of Object.keys(subs)) delete subs[k];
    },
    connected() {
      return client !== null;
    },
    pub(topic, o) {
      try {
        if (client) client.publish(NS + topic, JSON.stringify({ from: id, ...o }));
      } catch {
        // publish failures are non-fatal (legacy swallow)
      }
    },
    sub(topic, fn) {
      subs[NS + topic] = fn;
      client?.subscribe(NS + topic);
    },
    unsubscribe(topic) {
      try {
        client?.unsubscribe(NS + topic);
      } catch {
        // ignore
      }
      delete subs[NS + topic];
    },
  };
}
