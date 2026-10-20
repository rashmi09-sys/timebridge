import { setFormatLocale } from '../../src/lib/time';

// Formatting follows the browser's locale; unit tests pin US English so results don't depend on the machine.
setFormatLocale('en-US');
