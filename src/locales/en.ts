// The English reference pack (`@luxalgo/vela/locales/en`): every core message id with its
// English text, exactly as the source declares it. English needs no pack, since each
// message carries its English text, so registering this one changes nothing on screen.
// It is the template every translation starts from, and a base for rewording English.
import type { LocalePack } from '../core/i18n/types';
import messages from './en.json';

const en: LocalePack = { locale: 'en', messages };

export default en;
