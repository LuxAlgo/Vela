import { msg } from '../../i18n/message';
import type { InputLabels } from '../localize';

/**
 * Shown labels for the catalog's section names and option values. Both are identities
 * (a saved layout stores the option value, inputs key their section by name), so they
 * stay English in the schema and only read translated. Abbreviations such as SMA, HL2 and
 * RMA (SMMA) are not listed: they read the same in every language. Named methods are, since
 * other scripts write the names in their own letters.
 */
export const CLASSIC_INPUT_LABELS: InputLabels = {
    groups: {
        Settings: msg('indicator.group.settings', 'Settings'),
        Style: msg('indicator.group.style', 'Style'),
        'Trend Regime': msg('indicator.group.trendRegime', 'Trend Regime'),
        Thresholds: msg('indicator.group.thresholds', 'Thresholds'),
        'Squeeze & Bulge': msg('indicator.group.squeezeBulge', 'Squeeze & Bulge'),
        'Alligator Lines': msg('indicator.group.alligatorLines', 'Alligator Lines'),
        'Trigger Levels': msg('indicator.group.triggerLevels', 'Trigger Levels'),
        Oscillator: msg('indicator.group.oscillator', 'Oscillator'),
    },
    options: {
        Close: msg('indicator.option.close', 'Close'),
        Open: msg('indicator.option.open', 'Open'),
        High: msg('indicator.option.high', 'High'),
        Low: msg('indicator.option.low', 'Low'),
        'Momentum (|CMO|)': msg('indicator.option.momentumCmo', 'Momentum (|CMO|)'),
        'Volatility (StDev Ratio)': msg('indicator.option.volatilityStdevRatio', 'Volatility (StDev Ratio)'),
        Indicator: msg('indicator.option.indicator', 'Indicator'),
        Oscillator: msg('indicator.option.oscillator', 'Oscillator'),
        Momentum: msg('indicator.option.momentum', 'Momentum'),
        Session: msg('indicator.option.session', 'Session'),
        Week: msg('indicator.option.week', 'Week'),
        Month: msg('indicator.option.month', 'Month'),
        Quarter: msg('indicator.option.quarter', 'Quarter'),
        Year: msg('indicator.option.year', 'Year'),
        'Standard Deviation': msg('indicator.option.standardDeviation', 'Standard Deviation'),
        Percentage: msg('indicator.option.percentage', 'Percentage'),
        Traditional: msg('indicator.option.traditional', 'Traditional'),
        Fibonacci: msg('indicator.option.fibonacci', 'Fibonacci'),
        Camarilla: msg('indicator.option.camarilla', 'Camarilla'),
        Woodie: msg('indicator.option.woodie', 'Woodie'),
        'ROC %': msg('indicator.option.rocPercent', 'ROC %'),
        McGinley: msg('indicator.option.mcGinley', 'McGinley'),
        Hamming: msg('indicator.option.hamming', 'Hamming'),
        'SMMA (Wilder)': msg('indicator.option.smmaWilder', 'SMMA (Wilder)'),
        'Wilder (RMA)': msg('indicator.option.wilderRma', 'Wilder (RMA)'),
        Auto: msg('indicator.option.auto', 'Auto'),
        Daily: msg('indicator.option.daily', 'Daily'),
        Weekly: msg('indicator.option.weekly', 'Weekly'),
        Monthly: msg('indicator.option.monthly', 'Monthly'),
        Yearly: msg('indicator.option.yearly', 'Yearly'),
        'Position vs Average': msg('indicator.option.positionVsAverage', 'Position vs Average'),
        'Single Color': msg('indicator.option.singleColor', 'Single Color'),
        'Normalized Oscillator (II%)': msg('indicator.option.normalizedOscillator', 'Normalized Oscillator (II%)'),
        'Cumulative Line': msg('indicator.option.cumulativeLine', 'Cumulative Line'),
    },
};
