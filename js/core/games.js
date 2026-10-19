// Game catalogue shared by the shell, the learning pages and the reports. tag: the home card badge (2 words).

export const GAMES = [
  {
    id: 'blockslide',
    name: 'Block Slide',
    skill: 'Planning and spatial reasoning',
    tag: 'Spatial planning',
    blurb: 'Slide blocks out of the way and steer the ball to the exit in the fewest moves.',
    ready: true,
  },
  {
    id: 'latinsquare',
    name: 'Latin Square',
    skill: 'Deductive reasoning',
    tag: 'Deductive reasoning',
    blurb: 'Work out the hidden symbol from row and column rules: every symbol once per line.',
    ready: true,
  },
  {
    id: 'gridmemory',
    name: 'Grid Memory',
    skill: 'Working memory, dual task',
    tag: 'Working memory',
    blurb: 'Remember positions on a grid while answering quick side questions in between.',
    ready: true,
  },
  {
    id: 'operatorswitch',
    name: 'Operator Switch',
    skill: 'Numerical reasoning',
    tag: 'Numerical reasoning',
    blurb: 'Figure out which hidden operations turn the inputs into the outputs.',
    ready: true,
  },
  {
    id: 'digitequation',
    name: 'Digit Equation',
    skill: 'Numerical reasoning',
    tag: 'Numerical reasoning',
    blurb: 'Pick the digits that make a short equation true, against the clock.',
    ready: true,
  },
  {
    id: 'patternrule',
    name: 'Pattern Rule',
    skill: 'Inductive reasoning',
    tag: 'Inductive reasoning',
    blurb: 'Spot the rule that separates the shapes that fit from those that do not.',
    ready: true,
  },
];

export const GAME_IDS = GAMES.map((g) => g.id);
export const gameName = (id) => GAMES.find((g) => g.id === id)?.name ?? id;
export const isGame = (id) => GAME_IDS.includes(id);
