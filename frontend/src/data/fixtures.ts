import type { ScenarioFixture, ScenarioId } from '../types'

const CITY_PORTAL = 'City open data portal (sample record)'
const TRANSIT_PORTAL = 'Transit open data (sample record)'
const HEALTH_PORTAL = 'Public health open data (sample record)'
const ENV_PORTAL = 'Environment open data (sample record)'

export const SCENARIOS: ScenarioFixture[] = [
  {
    id: 'pedestrian-safety',
    exampleQuestion:
      'What affects pedestrian safety near schools in Washington, DC?',
    groups: [
      {
        purpose: 'Locations',
        datasets: [
          {
            id: 'ps-school-locations',
            title: 'School locations (sample)',
            source: CITY_PORTAL,
            purpose: 'Locations',
            usefulness:
              'Shows where schools are located so the streets and crossings around each one can be examined.',
            details: [
              'Illustrative fields: school name, street address, ward (sample).',
              'Use it to draw study areas around each school.',
              'Pairs with the crash and crossing records in the other groups.',
            ],
          },
          {
            id: 'ps-crossings',
            title: 'Marked crosswalks and intersections (sample)',
            source: CITY_PORTAL,
            purpose: 'Locations',
            usefulness:
              'Identifies marked crossings and intersection layouts, which matter most on routes students walk.',
            details: [
              'Illustrative fields: crossing type, street names (sample).',
              'Use it to spot schools with few marked crossings nearby.',
            ],
          },
        ],
      },
      {
        purpose: 'Outcomes',
        datasets: [
          {
            id: 'ps-ped-crashes',
            title: 'Traffic crashes involving pedestrians (sample)',
            source: CITY_PORTAL,
            purpose: 'Outcomes',
            usefulness:
              'Shows where pedestrian crashes have occurred so patterns near schools stand out.',
            details: [
              'Illustrative fields: location, time band, severity band (sample).',
              'Narrow the records to school zones and school travel hours.',
            ],
          },
          {
            id: 'ps-school-zone-speeds',
            title: 'School zone speed observations (sample)',
            source: CITY_PORTAL,
            purpose: 'Outcomes',
            usefulness:
              'Indicates whether drivers slow down in posted school zones during arrival and dismissal.',
            details: [
              'Illustrative fields: street segment, observed speed band (sample).',
              'Compare streets with and without traffic-calming features.',
            ],
          },
        ],
      },
      {
        purpose: 'Context',
        datasets: [
          {
            id: 'ps-sidewalks',
            title: 'Sidewalk network (sample)',
            source: CITY_PORTAL,
            purpose: 'Context',
            usefulness:
              'Reveals gaps in sidewalks on the routes students may walk to school.',
            details: [
              'Illustrative fields: street segment, sidewalk presence (sample).',
              'Overlay with crash locations to find risky walking routes.',
            ],
          },
          {
            id: 'ps-enrollment',
            title: 'Student enrollment by school (sample)',
            source: CITY_PORTAL,
            purpose: 'Context',
            usefulness:
              'Helps weigh findings by how many students each school serves.',
            details: [
              'Illustrative fields: school name, enrolled students (sample).',
              'Use it to prioritize the busiest school zones first.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'healthcare-access',
    exampleQuestion:
      'How is access to healthcare distributed across Washington, DC?',
    groups: [
      {
        purpose: 'Locations',
        datasets: [
          {
            id: 'ha-facilities',
            title: 'Health facility locations (sample)',
            source: HEALTH_PORTAL,
            purpose: 'Locations',
            usefulness:
              'Maps clinics, hospitals, and pharmacies so underserved neighborhoods can be identified.',
            details: [
              'Illustrative fields: facility type, address, ward (sample).',
              'Use it to measure distance from each neighborhood to the nearest facility.',
            ],
          },
          {
            id: 'ha-transit-stops',
            title: 'Public transit stops (sample)',
            source: TRANSIT_PORTAL,
            purpose: 'Locations',
            usefulness:
              'Shows transit access, which determines whether residents can reach facilities without a car.',
            details: [
              'Illustrative fields: stop name, routes served (sample).',
              'Combine with facility locations to find poorly connected areas.',
            ],
          },
        ],
      },
      {
        purpose: 'Outcomes',
        datasets: [
          {
            id: 'ha-preventive-visits',
            title: 'Preventive care visits by neighborhood (sample)',
            source: HEALTH_PORTAL,
            purpose: 'Outcomes',
            usefulness:
              'Suggests where residents receive routine care and where they may face barriers to it.',
            details: [
              'Illustrative fields: neighborhood, visit rate band (sample).',
              'Compare visit patterns across neighborhoods with similar populations.',
            ],
          },
          {
            id: 'ha-avoidable-ed',
            title: 'Avoidable emergency visits by neighborhood (sample)',
            source: HEALTH_PORTAL,
            purpose: 'Outcomes',
            usefulness:
              'Highlights areas where people rely on emergency care for conditions routine care could address.',
            details: [
              'Illustrative fields: neighborhood, visit rate band (sample).',
              'High rates may point to gaps in nearby primary care.',
            ],
          },
        ],
      },
      {
        purpose: 'Context',
        datasets: [
          {
            id: 'ha-population',
            title: 'Population by neighborhood (sample)',
            source: CITY_PORTAL,
            purpose: 'Context',
            usefulness:
              'Puts facility counts and visit rates in proportion to how many people live in each area.',
            details: [
              'Illustrative fields: neighborhood, residents (sample).',
              'Use it to compute residents per facility.',
            ],
          },
          {
            id: 'ha-income',
            title: 'Median household income by neighborhood (sample)',
            source: CITY_PORTAL,
            purpose: 'Context',
            usefulness:
              'Adds economic context, since income often relates to healthcare access and outcomes.',
            details: [
              'Illustrative fields: neighborhood, income band (sample).',
              'Use it to check whether access gaps follow income patterns.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'flood-exposure',
    exampleQuestion:
      'Which community facilities in Washington, DC face the greatest flood exposure?',
    groups: [
      {
        purpose: 'Locations',
        datasets: [
          {
            id: 'fe-facilities',
            title: 'Community facility locations (sample)',
            source: CITY_PORTAL,
            purpose: 'Locations',
            usefulness:
              'Lists libraries, recreation centers, and shelters whose flood exposure needs assessment.',
            details: [
              'Illustrative fields: facility type, address, ward (sample).',
              'Use it as the list of places to evaluate.',
            ],
          },
          {
            id: 'fe-floodplains',
            title: 'Floodplain boundaries (sample)',
            source: ENV_PORTAL,
            purpose: 'Locations',
            usefulness:
              'Marks zones with known flood risk so facilities inside them can be flagged.',
            details: [
              'Illustrative fields: zone type, boundary area (sample).',
              'Overlay facility locations to find sites inside risk zones.',
            ],
          },
        ],
      },
      {
        purpose: 'Outcomes',
        datasets: [
          {
            id: 'fe-flood-reports',
            title: 'Past flood incident reports (sample)',
            source: ENV_PORTAL,
            purpose: 'Outcomes',
            usefulness:
              'Records where flooding has been reported, grounding the risk zones in past events.',
            details: [
              'Illustrative fields: location, report count band (sample).',
              'Look for facilities near repeated incident clusters.',
            ],
          },
          {
            id: 'fe-closures',
            title: 'Facility closure reports (sample)',
            source: CITY_PORTAL,
            purpose: 'Outcomes',
            usefulness:
              'Shows when community facilities closed, which can reflect flood disruption.',
            details: [
              'Illustrative fields: facility name, closure reason (sample).',
              'Cross-check closure reasons before treating them as flood-related.',
            ],
          },
        ],
      },
      {
        purpose: 'Context',
        datasets: [
          {
            id: 'fe-impervious',
            title: 'Impervious surface coverage (sample)',
            source: ENV_PORTAL,
            purpose: 'Context',
            usefulness:
              'Indicates where pavement prevents drainage and worsens local flooding.',
            details: [
              'Illustrative fields: area, paved share band (sample).',
              'Use it to explain why some facilities flood more often.',
            ],
          },
          {
            id: 'fe-population-served',
            title: 'Population served by each facility (sample)',
            source: CITY_PORTAL,
            purpose: 'Context',
            usefulness:
              'Estimates how many residents depend on each facility, helping prioritize protection.',
            details: [
              'Illustrative fields: facility name, residents served (sample).',
              'Use it to rank exposed facilities by community impact.',
            ],
          },
        ],
      },
    ],
  },
]

export function normalizeQuestion(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function matchScenarioId(question: string): ScenarioId | null {
  const normalized = normalizeQuestion(question)
  const found = SCENARIOS.find(
    (scenario) => normalizeQuestion(scenario.exampleQuestion) === normalized,
  )
  return found ? found.id : null
}

export function matchScenario(question: string): ScenarioFixture | null {
  const id = matchScenarioId(question)
  if (id === null) return null
  return SCENARIOS.find((scenario) => scenario.id === id) ?? null
}
