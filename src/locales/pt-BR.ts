// `@luxalgo/vela/locales/pt-BR`: every core message in Brazilian Portuguese. Importing it
// registers nothing: pass it to `registerLocale`, then set the locale `'pt-BR'`.
import type { LocalePack } from '../core/i18n/types';
import messages from './pt-BR.json';

const ptBR: LocalePack = { locale: 'pt-BR', messages };

export default ptBR;
