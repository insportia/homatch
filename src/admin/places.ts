/*
 * The admin seam onto the place gazetteer.
 *
 * Buyer intelligence and market segmentation let an admin type a city or
 * district in any script (ვაკე / Ваке / Vake). The names come from the one
 * Find Buyers gazetteer rather than a second list kept in the UI; admin
 * components import this seam, never the research core.
 */
export { CITY_NAMES, DISTRICT_NAMES, normKey } from '@/research-core/findBuyers/places';
