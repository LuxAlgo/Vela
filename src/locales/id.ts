// `@luxalgo/vela/locales/id`: every core message in Indonesian. Importing it
// registers nothing: pass it to `registerLocale`, then set the locale `'id'`.
import type { LocalePack } from '../core/i18n/types';
import messages from './id.json';

const id: LocalePack = { locale: 'id', messages };

export default id;
