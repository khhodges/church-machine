# AbstractGTManager — Phase 1 mathematical constants

**Status: approved catalogue.** The user approved the following 100 entries
for Phase 1. This is design approval, not implementation or runtime evidence.
List numbers are review positions, not assigned token encodings.

Each name identifies an exact mathematical value, not a rounded decimal
stored in the proposed 27-bit payload. Aliases such as PHI and GOLDEN_RATIO
identify one token. Logical TRUE/FALSE remain separate from numeric ONE/ZERO.
Token bit positions, payload assignments and numerical evaluation are not
specified by this catalogue approval.

## Basic values

| # | Name | Exact value |
|---:|---|---|
| 1 | ZERO | 0 |
| 2 | ONE | 1 |
| 3 | NEG_ONE | -1 |
| 4 | TWO | 2 |
| 5 | NEG_TWO | -2 |
| 6 | THREE | 3 |
| 7 | FOUR | 4 |
| 8 | FIVE | 5 |
| 9 | TEN | 10 |
| 10 | HUNDRED | 100 |
| 11 | I | Imaginary unit i |
| 12 | NEG_I | -i |
| 13 | HALF | 1/2 |
| 14 | THIRD | 1/3 |
| 15 | QUARTER | 1/4 |
| 16 | FIFTH | 1/5 |
| 17 | SIXTH | 1/6 |
| 18 | TENTH | 1/10 |
| 19 | TWO_THIRDS | 2/3 |
| 20 | THREE_QUARTERS | 3/4 |

## Roots and ratios

| # | Name | Exact value or definition |
|---:|---|---|
| 21 | SQRT_TWO | sqrt(2) |
| 22 | SQRT_THREE | sqrt(3) |
| 23 | SQRT_FIVE | sqrt(5) |
| 24 | SQRT_SIX | sqrt(6) |
| 25 | SQRT_SEVEN | sqrt(7) |
| 26 | SQRT_TEN | sqrt(10) |
| 27 | SQRT_ELEVEN | sqrt(11) |
| 28 | SQRT_THIRTEEN | sqrt(13) |
| 29 | INV_SQRT_TWO | 1/sqrt(2) |
| 30 | INV_SQRT_THREE | 1/sqrt(3) |
| 31 | CBRT_TWO | Real cube root of 2 |
| 32 | CBRT_THREE | Real cube root of 3 |
| 33 | CBRT_FIVE | Real cube root of 5 |
| 34 | FOURTH_ROOT_TWO | Positive fourth root of 2 |
| 35 | GOLDEN_RATIO | phi = (1+sqrt(5))/2 |
| 36 | INV_GOLDEN_RATIO | 1/phi |
| 37 | SILVER_RATIO | 1+sqrt(2) |
| 38 | PLASTIC_RATIO | Real root of x^3=x+1 |
| 39 | TRIBONACCI_CONSTANT | Real root greater than 1 of x^3=x^2+x+1 |
| 40 | SUPERGOLDEN_RATIO | Real root greater than 1 of x^3=x^2+1 |

## Circle and Gaussian constants

| # | Name | Exact value |
|---:|---|---|
| 41 | PI | pi |
| 42 | TAU | 2*pi |
| 43 | HALF_PI | pi/2 |
| 44 | QUARTER_PI | pi/4 |
| 45 | THIRD_PI | pi/3 |
| 46 | SIXTH_PI | pi/6 |
| 47 | EIGHTH_PI | pi/8 |
| 48 | TWELFTH_PI | pi/12 |
| 49 | DEG_TO_RAD | pi/180 |
| 50 | RAD_TO_DEG | 180/pi |
| 51 | INV_PI | 1/pi |
| 52 | INV_TAU | 1/(2*pi) |
| 53 | TWO_OVER_PI | 2/pi |
| 54 | FOUR_OVER_PI | 4/pi |
| 55 | PI_SQUARED | pi^2 |
| 56 | SQRT_PI | sqrt(pi) |
| 57 | SQRT_TAU | sqrt(2*pi) |
| 58 | INV_SQRT_TAU | 1/sqrt(2*pi) |
| 59 | SQRT_TWO_OVER_PI | sqrt(2/pi) |
| 60 | TWO_OVER_SQRT_PI | 2/sqrt(pi) |

## Exponential and logarithmic constants

LN denotes the natural logarithm.

| # | Name | Exact value |
|---:|---|---|
| 61 | E | Euler's number e |
| 62 | E_SQUARED | e^2 |
| 63 | E_CUBED | e^3 |
| 64 | INV_E | 1/e |
| 65 | SQRT_E | sqrt(e) |
| 66 | E_TO_PI | e^pi (Gelfond's constant) |
| 67 | E_TO_NEG_PI | e^(-pi) |
| 68 | TWO_TO_SQRT_TWO | 2^sqrt(2) (Gelfond-Schneider constant) |
| 69 | LN_TWO | ln(2) |
| 70 | LN_THREE | ln(3) |
| 71 | LN_FIVE | ln(5) |
| 72 | LN_TEN | ln(10) |
| 73 | LN_PI | ln(pi) |
| 74 | LN_GOLDEN_RATIO | ln(phi) |
| 75 | LOG2_E | 1/ln(2) |
| 76 | LOG10_E | 1/ln(10) |
| 77 | LOG2_TEN | ln(10)/ln(2) |
| 78 | LOG10_TWO | ln(2)/ln(10) |
| 79 | LN_TWO_SQUARED | (ln(2))^2 |
| 80 | LN_SQRT_TWO | ln(2)/2 |

## Established named constants

| # | Name | Definition |
|---:|---|---|
| 81 | EULER_MASCHERONI | Limit of H_n-ln(n) as n tends to infinity |
| 82 | CATALAN | Sum over n>=0 of (-1)^n/(2n+1)^2 |
| 83 | APERY | zeta(3) |
| 84 | ZETA_FIVE | zeta(5) |
| 85 | ZETA_SEVEN | zeta(7) |
| 86 | ZETA_NINE | zeta(9) |
| 87 | KHINCHIN | Khinchin's continued-fraction constant |
| 88 | GLAISHER_KINKELIN | Glaisher-Kinkelin constant |
| 89 | FEIGENBAUM_DELTA | Period-doubling parameter-scaling constant |
| 90 | FEIGENBAUM_ALPHA | Positive magnitude of the period-doubling spatial-scaling constant |
| 91 | OMEGA | Positive solution of x*exp(x)=1 |
| 92 | LIOUVILLE | Sum over n>=1 of 10^(-n!) |
| 93 | CHAMPERNOWNE_BASE10 | 0.123456789101112... |
| 94 | CONWAY | Asymptotic growth constant of the look-and-say sequence |
| 95 | BRUN_TWIN_PRIMES | Sum of reciprocals of twin-prime pairs |
| 96 | TWIN_PRIME_CONSTANT | Product over primes p>2 of p*(p-2)/(p-1)^2 |
| 97 | MEISSEL_MERTENS | Limit of sum over primes p<=x of 1/p, minus ln(ln(x)) |
| 98 | LANDAU_RAMANUJAN | Constant governing the count of integers expressible as a sum of two squares |
| 99 | LAPLACE_LIMIT | Convergence-limit constant for the classical eccentricity expansion of Kepler's equation |
| 100 | RAMANUJAN_SOLDNER | Positive zero greater than 1 of the logarithmic integral li(x) |
