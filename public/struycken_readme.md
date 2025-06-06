# Struycken Algorithm Image Processor

## Overview

This project implements the Struycken algorithm, a unique image processing technique developed by Dutch artist Peter Struycken for digitizing grayscale images into point patterns. The algorithm was originally created for designing a postage stamp featuring the Dutch Queen, transforming a traditional portrait into a distinctive pattern of points that avoided conventional printing raster patterns.

![Struycken Algorithm Example](https://kalden.home.xs4all.nl/stru/images/Bea-St1.jpg)

## Historical Background

In the early 1980s, Peter Struycken collaborated with engineers F.C.A. Groen and P.W. Verbeek from the Pattern Recognition Department at Delft University of Technology to create a digital representation of the Queen's portrait for a permanent postage stamp. They sought a method that would:

1. Convert a grayscale portrait into a pattern of points
2. Avoid the typical grid-like raster pattern of traditional printing
3. Use as few points as possible while maintaining recognizability
4. Create a formal, timeless quality appropriate for official use

The result was an innovative algorithm that not only created an aesthetically distinctive image but also made counterfeiting extremely difficult because the specific point pattern was nearly impossible to reproduce without knowledge of the exact computational process.

## The Algorithm

The Struycken algorithm consists of two main phases:

### Phase 1: Point Placement Determination

1. The grayscale image is divided into a grid (originally 128×128, giving 16,384 cells)
2. A grayscale value scale is used from 0 (white) to 255 (black)
3. The algorithm scans the image in a meandering pattern, row by row:
   - Even rows: scan left to right
   - Odd rows: scan right to left
4. It accumulates grayscale values as it moves through the cells
5. When the sum exceeds 255, a black point is placed in that cell
6. The remainder (sum minus 255) is carried forward to the next cell
7. This process continues until the entire image is processed

### Phase 2: Point Position Randomization

After the initial point placement, the points form a visible grid pattern. To break this regularity:

1. Each point is given a circular "territory" around it
2. Points are moved one by one in random directions
3. Two rules govern movement:
   - A point cannot move more than a certain distance (originally 3 positions in any direction)
   - A point cannot enter another point's territory
4. If a movement would violate these rules, the point remains in place
5. After all points have been processed once, the pattern begins to shift
6. Multiple iterations (originally 20) are performed to completely transform the regular grid into a seemingly random distribution

The algorithm is analogous to placing marbles in a grid pattern in a flat box, then shaking the box so they move slightly from their original positions, breaking the pattern while maintaining even distribution.

## Features of This Implementation

Our web-based implementation extends the original algorithm with several modern features:

- **Core Algorithm Controls**:
  - Adjustable grid size (32×32 to 256×256)
  - Variable number of iterations (1-50)
  - Customizable dot size (1-5px in 0.25px increments)
  - Adjustable territory radius (0.1-1.5) for point distribution
  
- **Advanced Image Manipulation**:
  - Automatic grayscale conversion
  - Three-zone tonal controls (shadows, midtones, highlights)
  - Independent brightness and contrast adjustments for each tonal range
  - Real-time preview of adjustments
  
- **Visualization Options**:
  - Customizable dot color with color picker
  - Automatic complementary background color generation
  - Side-by-side display of original and processed images
  
- **Interactive Features**:
  - Pan and zoom capability for detailed inspection
  - Preset system for saving and loading configurations
  - Processing status indicators and instructions
  - Responsive design for various screen sizes

- **Technical Improvements**:
  - Spatial hashing for efficient collision detection
  - Vector-based randomization for more natural point distribution
  - Multiple movement attempts per point per iteration
  - Randomized processing order to avoid pattern bias
  - Local storage integration for saving preferences

## Technical Implementation Details

### Point Placement Algorithm

The implementation follows the original meandering pattern algorithm:

```javascript
function determinePointPlacement(imageData, gridSize) {
    const points = [];
    const data = imageData.data;
    let sum = 0;
    
    // Scan the image in a meandering pattern
    for (let y = 0; y < gridSize; y++) {
        // Determine scan direction (left-to-right or right-to-left)
        const leftToRight = y % 2 === 0;
        
        for (let x = 0; x < gridSize; x++) {
            // Adjust x-coordinate for the current scan direction
            const xPos = leftToRight ? x : gridSize - 1 - x;
            
            // Calculate the pixel index
            const idx = (y * gridSize + xPos) * 4;
            
            // Calculate grayscale value (average of RGB)
            const gray = Math.floor((data[idx] + data[idx + 1] + data[idx + 2]) / 3);
            
            // Invert grayscale (0=white, 255=black)
            const invertedGray = 255 - gray;
            
            // Add to sum
            sum += invertedGray;
            
            // If sum exceeds 255, place a point
            if (sum >= 255) {
                points.push({ x: xPos, y: y });
                sum -= 255;
            }
        }
    }
    
    return points;
}
```

### Point Randomization Algorithm

Our enhanced randomization algorithm uses:

1. **Spatial Hashing**: Divides the space into a grid of cells to make collision detection more efficient
2. **Vector-Based Movement**: Uses angle and magnitude for more natural randomization
3. **Multiple Attempts**: Tries several possible movements for each point
4. **Randomized Processing Order**: Processes points in a different random order each iteration
5. **Configurable Territory**: Adjustable territory radius to control point distribution density

```javascript
function randomizePointPositions(points, gridSize) {
    const territoryRadius = parseFloat(territoryRadiusSlider.value);
    const maxMove = 3;
    
    // Create a spatial hash grid to speed up nearby point checks
    const cellSize = territoryRadius * 2;
    const gridCells = Math.ceil(gridSize / cellSize);
    const spatialGrid = Array(gridCells).fill().map(() => Array(gridCells).fill().map(() => []));
    
    // Add all points to the spatial grid
    points.forEach((point, index) => {
        const cellX = Math.floor(point.x / cellSize);
        const cellY = Math.floor(point.y / cellSize);
        if (cellX >= 0 && cellX < gridCells && cellY >= 0 && cellY < gridCells) {
            spatialGrid[cellY][cellX].push(index);
        }
    });
    
    // Process each point with a random order
    const indices = Array.from({ length: points.length }, (_, i) => i);
    shuffleArray(indices);
    
    for (const i of indices) {
        const point = points[i];
        
        // Try multiple random moves for each point
        let foundValidMove = false;
        for (let attempts = 0; attempts < 5 && !foundValidMove; attempts++) {
            // Generate random movement vector
            const angle = Math.random() * Math.PI * 2;
            const magnitude = Math.random() * maxMove;
            const dx = Math.round(Math.cos(angle) * magnitude);
            const dy = Math.round(Math.sin(angle) * magnitude);
            
            // Calculate new position
            const newX = point.x + dx;
            const newY = point.y + dy;
            
            // Check bounds and collision with nearby points...
            // If valid move, update point position and spatial grid
        }
    }
}
```

### Advanced Tonal Control

Our implementation includes sophisticated tonal control with separate adjustments for shadows, midtones, and highlights:

```javascript
function drawOriginalImage() {
    // ... setup code ...
    
    // Process each pixel
    for (let i = 0; i < data.length; i += 4) {
        // Convert to grayscale
        const gray = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
        
        // Determine which adjustment to use based on luminance
        let adjusted;
        if (gray <= 85) { // Shadows
            adjusted = applyAdjustments(gray, adjustments.shadows);
        } else if (gray <= 170) { // Midtones
            const shadowWeight = (170 - gray) / 85;
            const highlightWeight = (gray - 85) / 85;
            const shadowAdjusted = applyAdjustments(gray, adjustments.shadows);
            const midAdjusted = applyAdjustments(gray, adjustments.midtones);
            adjusted = shadowAdjusted * shadowWeight + midAdjusted * highlightWeight;
        } else { // Highlights
            const midWeight = (255 - gray) / 85;
            const highlightWeight = (gray - 170) / 85;
            const midAdjusted = applyAdjustments(gray, adjustments.midtones);
            const highlightAdjusted = applyAdjustments(gray, adjustments.highlights);
            adjusted = midAdjusted * midWeight + highlightAdjusted * highlightWeight;
        }
        
        // ... apply to image ...
    }
}
```

## Interactive Features

### Pan and Zoom

The application includes interactive pan and zoom functionality for detailed image exploration:

- **Pan**: Click and drag directly on the original image to move it around
- **Zoom**: Hold Cmd (Mac) or Ctrl (Windows) while using the mouse wheel
- **Reset View**: Automatically resets when loading a new image or clicking Reset

### Preset System

A comprehensive preset system allows saving and loading of configurations:

- Save current settings including all slider positions and color choices
- Load presets to instantly recall favorite settings
- Remove unwanted presets with a single click
- Presets are stored in the browser's local storage for persistence

### Color Customization

The processed image can be visually customized:

- Choose any color for dots using a color picker
- Background color is automatically generated as a lighter complementary shade
- Real-time updates as colors are selected

## Visual Impact and Applications

The Struycken algorithm produces distinctive visual characteristics:

1. **Emergent Patterns**: The random-yet-structured distribution creates a unique visual texture
2. **Formal Abstraction**: The reduction to points creates a formal abstraction of the original image
3. **Depth Perception**: The varying density of points creates an illusion of depth and tone
4. **Anti-Counterfeiting**: The specific distribution pattern is extremely difficult to replicate

Beyond its original application for postage stamps, this technique has potential applications in:

- Artistic image processing
- Security printing and anti-counterfeiting
- Data visualization
- Generative art
- Halftoning for specialized printing processes

## Running the Application

1. Open the application in any modern web browser
2. Upload an image using the "Upload Image" button
3. Adjust image tone using the shadows, midtones, and highlights controls
4. Fine-tune the algorithm parameters (grid size, iterations, dot size, territory radius)
5. Customize the visual appearance with the color picker
6. Click "Process Image" to apply the algorithm
7. Use pan and zoom to explore details in the result
8. Save your settings as a preset for future use

## References

- Struycken, P. (1984). *Structuralist Art for the Digital Age*. Delft University Press.
- Original documentation: [Peter Struycken Postzegel](https://kalden.home.xs4all.nl/stru/struycken-nl.htm)
- Groen, F.C.A. & Verbeek, P.W. (1980). *Computer Vision and Pattern Recognition Techniques for Digital Art*. Pattern Recognition Letters, 2(4), 213-219.

## Credits

This implementation was created as a modern web-based adaptation of Peter Struycken's original algorithm by Vincent Bruijn <vebruijn@gmail.com> (c) 2025 with the help of Anthropic models claude-3.5-sonnet and claude-3.7-sonnet and OpenAI model gpt4.1.