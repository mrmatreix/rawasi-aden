/**
 * محرك التفقيط المالي العربي الشامل والمتوافق محاسبياً
 * Comprehensive Arabic Financial Tafqeet Engine
 * يدعم الأعداد الصحيحة والكسور النقدية (فلس، هللة، سنت، قرش) وقواعد الصرف والجمع والنحو المالي
 */

(function (global) {
  'use strict';

  const CURRENCY_DICTIONARY = {
    'ر.ي': {
      singular: 'ريال يمني',
      dual: 'ريالان يمنيان',
      plural: 'ريالات يمنية',
      accusative: 'ريالاً يمنياً',
      subSingular: 'فلس',
      subDual: 'فلسان',
      subPlural: 'فلوس',
      subAccusative: 'فلساً',
      decimals: 2
    },
    'YER': {
      singular: 'ريال يمني',
      dual: 'ريالان يمنيان',
      plural: 'ريالات يمنية',
      accusative: 'ريالاً يمنياً',
      subSingular: 'فلس',
      subDual: 'فلسان',
      subPlural: 'فلوس',
      subAccusative: 'فلساً',
      decimals: 2
    },
    'ر.س': {
      singular: 'ريال سعودي',
      dual: 'ريالان سعوديان',
      plural: 'ريالات سعودية',
      accusative: 'ريالاً سعودياً',
      subSingular: 'هللة',
      subDual: 'هللتان',
      subPlural: 'هللات',
      subAccusative: 'هللةً',
      decimals: 2
    },
    'SAR': {
      singular: 'ريال سعودي',
      dual: 'ريالان سعوديان',
      plural: 'ريالات سعودية',
      accusative: 'ريالاً سعودياً',
      subSingular: 'هللة',
      subDual: 'هللتان',
      subPlural: 'هللات',
      subAccusative: 'هللةً',
      decimals: 2
    },
    '$': {
      singular: 'دولار أمريكي',
      dual: 'دولاران أمريكيان',
      plural: 'دولارات أمريكية',
      accusative: 'دولاراً أمريكياً',
      subSingular: 'سنت',
      subDual: 'سنتان',
      subPlural: 'سنتات',
      subAccusative: 'سنتاً',
      decimals: 2
    },
    'USD': {
      singular: 'دولار أمريكي',
      dual: 'دولاران أمريكيان',
      plural: 'دولارات أمريكية',
      accusative: 'دولاراً أمريكياً',
      subSingular: 'سنت',
      subDual: 'سنتان',
      subPlural: 'سنتات',
      subAccusative: 'سنتاً',
      decimals: 2
    },
    'AED': {
      singular: 'درهم إماراتي',
      dual: 'درهمان إماراتيان',
      plural: 'دراهم إماراتية',
      accusative: 'درهماً إماراتياً',
      subSingular: 'فلس',
      subDual: 'فلسان',
      subPlural: 'فلوس',
      subAccusative: 'فلساً',
      decimals: 2
    },
    'د.إ': {
      singular: 'درهم إماراتي',
      dual: 'درهمان إماراتيان',
      plural: 'دراهم إماراتية',
      accusative: 'درهماً إماراتياً',
      subSingular: 'فلس',
      subDual: 'فلسان',
      subPlural: 'فلوس',
      subAccusative: 'فلساً',
      decimals: 2
    }
  };

  const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
  const TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

  function convertGroup(n) {
    if (n === 0) return '';
    const res = [];
    const h = Math.floor(n / 100);
    const rem = n % 100;

    if (h > 0) {
      res.push(HUNDREDS[h]);
    }

    if (rem > 0) {
      if (rem < 10) {
        res.push(ONES[rem]);
      } else if (rem < 20) {
        res.push(TEENS[rem - 10]);
      } else {
        const o = rem % 10;
        const t = Math.floor(rem / 10);
        if (o > 0) {
          res.push(ONES[o] + ' و' + TENS[t]);
        } else {
          res.push(TENS[t]);
        }
      }
    }

    return res.join(' و');
  }

  function numberToArabicWords(n) {
    if (n === 0) return 'صفر';
    const parts = [];

    const billions = Math.floor(n / 1000000000);
    n %= 1000000000;
    const millions = Math.floor(n / 1000000);
    n %= 1000000;
    const thousands = Math.floor(n / 1000);
    const units = n % 1000;

    if (billions > 0) {
      if (billions === 1) parts.push('مليار');
      else if (billions === 2) parts.push('ملياران');
      else if (billions >= 3 && billions <= 10) parts.push(convertGroup(billions) + ' مليارات');
      else parts.push(convertGroup(billions) + ' مليار');
    }

    if (millions > 0) {
      if (millions === 1) parts.push('مليون');
      else if (millions === 2) parts.push('مليونان');
      else if (millions >= 3 && millions <= 10) parts.push(convertGroup(millions) + ' ملايين');
      else parts.push(convertGroup(millions) + ' مليون');
    }

    if (thousands > 0) {
      if (thousands === 1) parts.push('ألف');
      else if (thousands === 2) parts.push('ألفان');
      else if (thousands >= 3 && thousands <= 10) parts.push(convertGroup(thousands) + ' آلاف');
      else parts.push(convertGroup(thousands) + ' ألف');
    }

    if (units > 0) {
      parts.push(convertGroup(units));
    }

    return parts.join(' و');
  }

  function getCurrencyText(value, currDef, isFraction = false) {
    if (!currDef) return '';
    const v = Math.abs(Math.round(value));
    if (isFraction) {
      if (v === 1) return currDef.subSingular;
      if (v === 2) return currDef.subDual;
      if (v >= 3 && v <= 10) return currDef.subPlural;
      return currDef.subAccusative;
    } else {
      if (v === 1) return currDef.singular;
      if (v === 2) return currDef.dual;
      if (v >= 3 && v <= 10) return currDef.plural;
      return currDef.accusative;
    }
  }

  function Tafqeet(amount, currency = 'ر.ي') {
    if (amount === null || amount === undefined || isNaN(amount)) return '';
    const num = Number(amount);
    if (num <= 0) return 'صفر ' + (CURRENCY_DICTIONARY[currency]?.singular || currency);

    const currDef = CURRENCY_DICTIONARY[currency] || CURRENCY_DICTIONARY['ر.ي'];
    const integerPart = Math.floor(num);
    const fractionFactor = Math.pow(10, currDef.decimals || 2);
    const fractionPart = Math.round((num - integerPart) * fractionFactor);

    const words = [];

    if (integerPart > 0) {
      const intWords = numberToArabicWords(integerPart);
      const currUnit = getCurrencyText(integerPart, currDef, false);
      if (integerPart === 1) {
        words.push(currDef.singular);
      } else if (integerPart === 2) {
        words.push(currDef.dual);
      } else {
        words.push(intWords + ' ' + currUnit);
      }
    }

    if (fractionPart > 0) {
      const fracWords = numberToArabicWords(fractionPart);
      const fracUnit = getCurrencyText(fractionPart, currDef, true);
      if (fractionPart === 1) {
        words.push(currDef.subSingular);
      } else if (fractionPart === 2) {
        words.push(currDef.subDual);
      } else {
        words.push(fracWords + ' ' + fracUnit);
      }
    }

    if (words.length === 0) {
      return 'صفر ' + currDef.singular;
    }

    return words.join(' و');
  }

  global.Tafqeet = Tafqeet;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Tafqeet;
  }
})(typeof window !== 'undefined' ? window : global);
