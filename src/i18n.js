// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object. They
// never quote a text of the device: only our own words and error codes.
// -----------------------------------------------------------------------------

const seconds = (ms) => Math.max(1, Math.round(ms / 1000));
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
const delay = (ms) =>
  ms >= 60_000
    ? { en: `${minutes(ms)} min`, fr: `${minutes(ms)} min` }
    : { en: `${seconds(ms)} s`, fr: `${seconds(ms)} s` };

/** Our words for an error code of src/p1monitor/client.js. */
const REASON = {
  timeout: { en: 'no answer', fr: 'pas de réponse' },
  unreachable: { en: 'unreachable', fr: 'injoignable' },
  http: { en: 'HTTP error', fr: 'erreur HTTP' },
  too_large: { en: 'answer too large', fr: 'réponse trop grande' },
  not_data: { en: 'answer that is not data', fr: 'réponse qui n’est pas une donnée' },
  unknown_answer: {
    en: 'not a P1 Monitor answer',
    fr: 'réponse qui n’est pas celle d’un P1 Monitor',
  },
  no_data: {
    en: 'no reading of the meter yet',
    fr: 'aucun relevé du compteur pour l’instant',
  },
};

export function reason(err) {
  const text = REASON[err?.code] ?? { en: 'unexpected error', fr: 'erreur inattendue' };
  const status = err?.code === 'http' && err.status ? ` ${err.status}` : '';
  return { en: `${text.en}${status}`, fr: `${text.fr}${status}` };
}

/** The names of the secondary pages, for the status. */
const PAGE = {
  phases: { en: 'phases', fr: 'phases' },
  prices: { en: 'prices', fr: 'prix' },
  water: { en: 'water meter', fr: 'compteur d’eau' },
};

export const T = {
  noAddress: {
    en: 'Enter the address of your P1 Monitor (its IP address on your network, e.g. 192.168.1.40).',
    fr: 'Saisissez l’adresse de votre P1 Monitor (son adresse IP sur votre réseau, ex. 192.168.1.40).',
  },
  badAddress: {
    en: 'The P1 Monitor address is not valid: enter an IP address or a host name, with an optional port (e.g. 192.168.1.40).',
    fr: 'L’adresse du P1 Monitor n’est pas valide : saisissez une adresse IP ou un nom d’hôte, avec un port éventuel (ex. 192.168.1.40).',
  },
  unreachable: (address, err, wait) => ({
    en: `The P1 Monitor at ${address} could not be read (${reason(err).en}): new try in ${delay(wait).en}.`,
    fr: `Le P1 Monitor à l’adresse ${address} n’a pas pu être lu (${reason(err).fr}) : nouvel essai dans ${delay(wait).fr}.`,
  }),
  noDevice: {
    en: 'P1 Monitor found: create its device from the "Discover" tab to receive its values.',
    fr: 'P1 Monitor trouvé : créez son appareil depuis l’onglet « Découverte » pour recevoir ses valeurs.',
  },
  /** `notes`: { en, fr } texts added after the connection message. */
  ok: (address, notes = []) => ({
    en: [`Connected to the P1 Monitor (${address}).`, ...notes.map((n) => n.en)].join(' '),
    fr: [`Connecté au P1 Monitor (${address}).`, ...notes.map((n) => n.fr)].join(' '),
  }),
  notes: {
    pages: (pages) => ({
      en: `Some pages do not answer (${pages.map((p) => PAGE[p].en).join(', ')}): the other values go on.`,
      fr: `Certaines pages ne répondent pas (${pages.map((p) => PAGE[p].fr).join(', ')}) : les autres valeurs continuent.`,
    }),
    stale: {
      en: 'P1 Monitor gives no new reading of the meter (P1 cable?): the power is no longer sent.',
      fr: 'P1 Monitor ne donne plus de nouveau relevé du compteur (câble P1 ?) : la puissance n’est plus envoyée.',
    },
    noIndex: {
      en: 'The meter gives no index right now: the consumption index waits for it.',
      fr: 'Le compteur ne donne pas d’index en ce moment : l’index de consommation l’attend.',
    },
    jump: ({ from, to }) => ({
      en: `The consumption index jumped from ${from} to ${to} kWh: held back, not sent to the energy monitoring. If it is right, save the configuration of the integration to accept it (the difference is then counted once as consumption).`,
      fr: `L’index de consommation a sauté de ${from} à ${to} kWh : retenu, non envoyé au suivi énergétique. S’il est juste, enregistrez la configuration de l’intégration pour l’accepter (la différence est alors comptée une fois comme consommation).`,
    }),
  },
  test: {
    ok: (meter) => {
      const power = meter.power === undefined ? '?' : `${meter.power} W`;
      const index =
        meter.consumption.total === undefined
          ? '?'
          : `${Math.round(meter.consumption.total * 1000) / 1000} kWh`;
      return {
        en: `P1 Monitor read: power taken ${power}, consumption index ${index}.`,
        fr: `P1 Monitor lu : puissance prélevée ${power}, index de consommation ${index}.`,
      };
    },
    slow: {
      en: 'The P1 Monitor is slow to answer: look at the integration status in a minute.',
      fr: 'Le P1 Monitor tarde à répondre : regardez l’état de l’intégration dans une minute.',
    },
  },
};
