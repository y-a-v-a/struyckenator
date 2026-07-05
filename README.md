# Struyckenator

## Overview

This repository contains several modern web-based implementations of algorithmic artworks originally created by Dutch artist [Peter Struycken](https://en.wikipedia.org/wiki/Peter_Struycken). Struycken is a pioneer in computer art who has been exploring the relationship between mathematics, computation, and visual aesthetics since the 1960s.

The implementations in this repository include:

- **Struycken Algorithm Image Processor**: A recreation of Struycken's famous algorithm used to create the Dutch Queen's postage stamp in the 1980s. This implementation converts grayscale images to unique point patterns with advanced controls for tonal adjustment, point distribution, and visual customization.

- **Technisch Procédé (index3)**: A source-faithful re-implementation of the stamp procedure as described in [Paul Hefting's account](https://kalden.home.xs4all.nl/stru/struycken-nl.htm): a meander scan with carry places the dots, then the "box of marbles" is shaken — one die roll per dot per iteration, at most 3 places of drift, territories never violated. The algorithm lives in a DOM-free module (`public/js/struycken-core.js`) with a seeded PRNG, so every pattern is reproducible from its seed and shareable as a URL. Includes live invariant checks, in-page self-tests, and SVG/PNG/JSON export. Kept as the annotated reference version.

- **Struycken Image Processor (index4)**: The everyday app combining index2's workflow with index3's engine. Same faithful algorithm core, plus webcam capture, upload, drag-and-drop and paste, crop framing with pan/zoom, presets in localStorage, automatic paper color derived from the ink color, high-resolution PNG and SVG export, and shareable seed links.

- **Geometric Grid**: An interactive recreation of Struycken's geometric grid explorations, featuring dynamic triangular patterns with automatic refreshing.

- **Struyckenizer**: A generative algorithmic pattern creator inspired by Struycken's works with grayscale value gradients.

## AI-Assisted Development

These implementations were developed with the assistance of state-of-the-art AI models:

- Anthropic's Claude 3.5 Sonnet
- Anthropic's Claude 3.7 Sonnet
- Anthropic's Claude Fable 5
- OpenAI's GPT-4.1

The AI models assisted in:
- Implementing complex algorithms
- Creating responsive user interfaces
- Developing image processing techniques
- Building interactive controls and visualization capabilities

## Features

Each implementation includes various interactive features:

- Real-time parameter adjustment
- Visual customization options
- Responsive designs for different screen sizes
- Presets and storage capabilities
- Pan and zoom functionality for detailed exploration

## Usage

Open any of the HTML files in the `/public` directory in a modern web browser to explore the different implementations. Each implementation includes its own set of controls and options for creating unique visual experiences.

For more detailed information about specific implementations, refer to the individual documentation files in the `/public` directory.

To serve the files locally, run `npx serve .` from the `/public` directory; `serve.json` disables clean URLs so pages keep their `.html` extension.

## Testing

The `index3.html` algorithm core is DOM-free and covered by 14 deterministic tests (seeded PRNG, no wall clock), including a brute-force cross-check of the territory rule and the worked example from Hefting's text:

```
npm test
```

The identical suite runs in the browser via the "Run self-tests" button in `index3.html`.

## Historical Context

Peter Struycken's work represents a significant contribution to the field of computer-generated art. His approach to using algorithms and mathematical principles to create visual compositions has influenced generations of digital artists.

The implementations in this repository aim to preserve and extend his pioneering techniques, making them accessible to a contemporary audience through modern web technologies.

## Copyright

© 2025 Vincent Bruijn <vebruijn@gmail.com>

All code in this repository is the original work of Vincent Bruijn with AI assistance, implementing algorithmic principles originally developed by Peter Struycken.

Original artistic concepts and algorithms credit: Peter Struycken. 