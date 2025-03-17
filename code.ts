// Mosaic Plugin for Figma - Improved implementation with Canvas API brightness calculation

// Updated interface to include tile size variation
interface MosaicConfig {
  columnCount: number; // Number of component columns (width)
  tileSizeVariation: string; // "1x", "2x", or "4x"
  componentId?: string;
  enlargement: number;
  matchResolution: number;
  useComponentVariants: boolean;
  imageTransparencyIsWhite: boolean;
  componentTransparencyIsWhite: boolean;
  variationCount: number;
  tileSizeBase?: number; // Add this property
}

// Updated data structures for cell and component data
interface CellData {
  brightness: number;
  color: { r: number, g: number, b: number };
  transparencyRatio: number;
}

interface ComponentData {
  component: ComponentNode;
  brightness: number;
  color: { r: number, g: number, b: number };
  transparencyRatio: number;
}

// Main plugin code
figma.showUI(__html__, { width: 240, height: 350 });

// Type guard to check if node has fills
function hasFills(node: SceneNode): node is SceneNode & { fills: ReadonlyArray<Paint> } {
  return 'fills' in node && Array.isArray(node.fills);
}

// Update the getImageData function to use columnCount
async function getImageData(
  node: SceneNode,
  config: MosaicConfig
): Promise<CellData[][]> {
  // Calculate grid size based on columnCount
  const aspectRatio = node.height / node.width;
  const gridWidth = config.columnCount;
  const gridHeight = Math.round(gridWidth * aspectRatio);
  
  // Export the image as PNG
  let bytes: Uint8Array;
  try {
    bytes = await node.exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: 1 }
    });
  } catch (error) {
    console.error('Failed to export image:', error);
    // Create a fallback data map with default values
    const result: CellData[][] = [];
    for (let y = 0; y < gridHeight; y++) {
      result[y] = [];
      for (let x = 0; x < gridWidth; x++) {
        const relativeX = x / gridWidth;
        const relativeY = y / gridHeight;
        // Create a simple gradient fallback
        result[y][x] = {
          brightness: 0.3 + relativeX * 0.4 + relativeY * 0.3,
          color: { 
            r: 0.3 + relativeX * 0.7, 
            g: 0.3 + relativeY * 0.7, 
            b: 0.5 
          },
          transparencyRatio: 0
        };
      }
    }
    return result;
  }
  
  // Process the image data in UI context
  figma.ui.postMessage({
    type: 'process-image',
    bytes,
    gridSize: { width: gridWidth, height: gridHeight },
    imageTransparencyIsWhite: config.imageTransparencyIsWhite
  });
  
  console.log(`Sent image to UI for processing with grid size ${gridWidth}x${gridHeight}`);
  
  // Return a Promise that will resolve when UI sends back the result
  return new Promise((resolve) => {
    const handler = (msg: any) => {
      if (msg.type === 'image-data-result' && msg.dataMap) {
        console.log("Received image data from UI");
        figma.ui.off('message', handler);
        resolve(msg.dataMap);
      }
    };
    
    figma.ui.on('message', handler);
    
    // Add timeout for fallback
    setTimeout(() => {
      console.log("Timeout waiting for image data");
      figma.ui.off('message', handler);
      
      // Create a fallback data map
      const result: CellData[][] = [];
      for (let y = 0; y < gridHeight; y++) {
        result[y] = [];
        for (let x = 0; x < gridWidth; x++) {
          const relativeX = x / gridWidth;
          const relativeY = y / gridHeight;
          result[y][x] = {
            brightness: 0.3 + relativeX * 0.4 + relativeY * 0.3,
            color: { 
              r: 0.3 + relativeX * 0.7, 
              g: 0.3 + relativeY * 0.7, 
              b: 0.5 
            },
            transparencyRatio: 0
          };
        }
      }
      resolve(result);
    }, 10000);
  });
}

// Function to get component data
async function getComponentData(
  components: ComponentNode[], 
  config: MosaicConfig
): Promise<ComponentData[]> {
  figma.notify(`Analyzing ${components.length} components...`, { timeout: 1000 });
  
  // Create array to hold component data
  const componentData: ComponentData[] = [];
  const pendingResults = new Map<string, {
    component: ComponentNode,
    resolve: (data: any) => void
  }>();
  
  // Set up message handler
  const messageHandler = (msg: any) => {
    if (msg.type === 'component-data-result' && msg.componentId) {
      const pending = pendingResults.get(msg.componentId);
      if (pending) {
        console.log(`Received data for ${msg.componentId}`);
        pending.resolve(msg.componentData);
        pendingResults.delete(msg.componentId);
      }
    }
  };
  
  figma.ui.on('message', messageHandler);
  
  // Process components in parallel
  const promises = components.map(async (component) => {
    try {
      // Export component as PNG
      const bytes = await component.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: 1 }
      });
      
      // Calculate component data using UI
      const data = await new Promise<any>((resolve) => {
        pendingResults.set(component.id, { component, resolve });
        
        figma.ui.postMessage({
          type: 'process-component',
          componentId: component.id,
          bytes,
          componentTransparencyIsWhite: config.componentTransparencyIsWhite
        });
        
        // Add timeout for this component
        setTimeout(() => {
          if (pendingResults.has(component.id)) {
            console.log(`Timeout for component ${component.id}`);
            pendingResults.delete(component.id);
            resolve({
              brightness: 0.5,
              color: { r: 0.5, g: 0.5, b: 0.5 },
              transparencyRatio: 0
            });
          }
        }, 5000);
      });
      
      return { component, ...data };
    } catch (error) {
      console.error(`Error processing component ${component.name}:`, error);
      return { 
        component, 
        brightness: 0.5,
        color: { r: 0.5, g: 0.5, b: 0.5 },
        transparencyRatio: 0
      };
    }
  });
  
  // Wait for all promises to resolve
  const results = await Promise.all(promises);
  
  // Clean up
  figma.ui.off('message', messageHandler);
  
  return results;
}

// Helper function to create variations of the mosaic
async function createMosaicVariations(
  baseFrame: FrameNode, 
  imageData: CellData[][], 
  componentLibrary: ComponentData[],
  config: MosaicConfig,
  xTileCount: number,
  yTileCount: number,
  variationCount: number
) {
  // Skip if only one variation requested (original already created)
  if (variationCount <= 1) return;
  
  figma.notify(`Creating ${variationCount - 1} variations...`, {timeout: 2000});
  
  // Create a parent frame to hold all mosaics
  const parentFrame = figma.createFrame();
  parentFrame.name = 'Mosaic Variations';
  
  // Calculate size based on original mosaic
  const mosaicWidth = baseFrame.width;
  const mosaicHeight = baseFrame.height;
  const parentWidth = mosaicWidth;
  const parentHeight = mosaicHeight * variationCount + (20 * (variationCount - 1)); // Add spacing between variations
  
  parentFrame.resize(parentWidth, parentHeight);
  parentFrame.x = baseFrame.x;
  parentFrame.y = baseFrame.y;
  
  // Add original mosaic to the parent frame
  figma.currentPage.appendChild(parentFrame);
  
  const originalMosaic = baseFrame.clone();
  originalMosaic.x = 0;
  originalMosaic.y = 0;
  parentFrame.appendChild(originalMosaic);
  baseFrame.remove(); // Remove the original standalone mosaic
  
  // Keep track of existing instance placements
  const instanceMap = new Map<string, ComponentNode>();
  
  // Ensure tileSizeBase is defined
  const tileSizeBase = config.tileSizeBase || (baseFrame.width / xTileCount);
  
  // Replace instances of config.tileSizeBase with tileSizeBase
  originalMosaic.children.forEach((child, index) => {
    if (child.type === 'INSTANCE') {
      const x = Math.floor(child.x / tileSizeBase);
      const y = Math.floor(child.y / tileSizeBase);
      instanceMap.set(`${x},${y}`, child.mainComponent);
    }
  });
  
  // Create each variation
  for (let i = 1; i < variationCount; i++) {
    try {
      // Create new mosaic (clone the original)
      const newMosaic = originalMosaic.clone();
      newMosaic.name = `Mosaic Variation ${i + 1}`;
      newMosaic.y = i * (mosaicHeight + 20); // Position below previous, with spacing
      parentFrame.appendChild(newMosaic);
      
      // Replace 5-10% of instances randomly
      const replacementPercentage = 5 + Math.floor(Math.random() * 6); // 5-10%
      const totalInstances = xTileCount * yTileCount;
      const numToReplace = Math.floor((replacementPercentage / 100) * totalInstances);
      
      // Choose random positions to replace
      const positionsToReplace = new Set<string>();
      while (positionsToReplace.size < numToReplace) {
        const x = Math.floor(Math.random() * xTileCount);
        const y = Math.floor(Math.random() * yTileCount);
        positionsToReplace.add(`${x},${y}`);
      }
      
      // Replace selected components with better alternatives
      positionsToReplace.forEach(posKey => {
        const [xStr, yStr] = posKey.split(',');
        const x = parseInt(xStr);
        const y = parseInt(yStr);
        
        // Find the instance at this position
        const instance = newMosaic.children.find(child => {
          return child.type === 'INSTANCE' && 
                 Math.floor(child.x / tileSizeBase) === x && 
                 Math.floor(child.y / tileSizeBase) === y;
        }) as InstanceNode;
        
        if (!instance) return; // Skip if not found
        
        // Get image data for this position
        const mapX = Math.min(imageData[0].length - 1, Math.floor(x * imageData[0].length / xTileCount));
        const mapY = Math.min(imageData.length - 1, Math.floor(y * imageData.length / yTileCount));
        const cellData = imageData[mapY][mapX];
        
        // Find a different component with a good match but not the exact same component
        const currentComponent = instance.mainComponent;
        const alternativeComponents = componentLibrary
          .filter(comp => comp.component.id !== currentComponent.id)
          .map(comp => {
            // Calculate brightness and color differences
            const brightnessDiff = Math.abs(cellData.brightness - comp.brightness);
            const colorDiff = Math.sqrt(
              Math.pow(cellData.color.r - comp.color.r, 2) +
              Math.pow(cellData.color.g - comp.color.g, 2) +
              Math.pow(cellData.color.b - comp.color.b, 2)
            ) / Math.sqrt(3);
            
            // Combined score (lower is better)
            const score = brightnessDiff * 0.6 + colorDiff * 0.4;
            
            return {
              component: comp.component,
              score
            };
          });
        
        // Sort by score (best matches first)
        alternativeComponents.sort((a, b) => a.score - b.score);
        
        // Pick one of the top 3 alternatives to introduce more randomness
        const randomIndex = Math.floor(Math.random() * Math.min(3, alternativeComponents.length));
        const selectedComponent = alternativeComponents[randomIndex]?.component;
        
        if (selectedComponent) {
          // Replace the instance
          const newInstance = selectedComponent.createInstance();
          newInstance.x = instance.x;
          newInstance.y = instance.y;
          newInstance.resize(tileSizeBase, tileSizeBase);
          
          // Add new instance and remove old one
          newMosaic.appendChild(newInstance);
          instance.remove();
        }
      });
      
      // Let the UI update between variations
      await new Promise(resolve => setTimeout(resolve, 0));
      
      figma.notify(`Created variation ${i + 1} of ${variationCount}`, {timeout: 500});
    } catch (error) {
      console.error(`Error creating variation ${i + 1}:`, error);
    }
  }
  
  figma.notify(`Created ${variationCount} mosaic variations`, {timeout: 2000});
}

// Helper function to determine appropriate component size for a region
function determineTileSize(
  imageData: CellData[][], 
  startX: number, 
  startY: number, 
  xTileCount: number,
  yTileCount: number,
  maxTileSize: number
): { size: number, averageBrightness: number, averageColor: {r: number, g: number, b: number} } {
  // Default to 1x1
  let size = 1;
  
  // If we don't allow larger tiles, return 1x1
  if (maxTileSize <= 1) {
    const cell = imageData[startY][startX];
    return { 
      size: 1, 
      averageBrightness: cell.brightness,
      averageColor: cell.color
    };
  }
  
  // Check if we can create a 2x2 tile
  if (maxTileSize >= 2 && 
      startX + 1 < xTileCount && 
      startY + 1 < yTileCount) {
    
    // Get the 4 cells that would form a 2x2 tile
    const topLeft = imageData[startY][startX];
    const topRight = imageData[startY][startX + 1];
    const bottomLeft = imageData[startY + 1][startX];
    const bottomRight = imageData[startY + 1][startX + 1];
    
    // Calculate the brightness variance
    const brightnesses = [
      topLeft.brightness,
      topRight.brightness,
      bottomLeft.brightness,
      bottomRight.brightness
    ];
    
    const avgBrightness = brightnesses.reduce((sum, b) => sum + b, 0) / 4;
    
    // Calculate max deviation from average brightness
    const maxBrightnessDev = Math.max(
      ...brightnesses.map(b => Math.abs(b - avgBrightness))
    );
    
    // Calculate color variance
    const avgColor = {
      r: (topLeft.color.r + topRight.color.r + bottomLeft.color.r + bottomRight.color.r) / 4,
      g: (topLeft.color.g + topRight.color.g + bottomLeft.color.g + bottomRight.color.g) / 4,
      b: (topLeft.color.b + topRight.color.b + bottomLeft.color.b + bottomRight.color.b) / 4
    };
    
    const colorDevs = [
      Math.sqrt(
        Math.pow(topLeft.color.r - avgColor.r, 2) +
        Math.pow(topLeft.color.g - avgColor.g, 2) +
        Math.pow(topLeft.color.b - avgColor.b, 2)
      ),
      Math.sqrt(
        Math.pow(topRight.color.r - avgColor.r, 2) +
        Math.pow(topRight.color.g - avgColor.g, 2) +
        Math.pow(topRight.color.b - avgColor.b, 2)
      ),
      Math.sqrt(
        Math.pow(bottomLeft.color.r - avgColor.r, 2) +
        Math.pow(bottomLeft.color.g - avgColor.g, 2) +
        Math.pow(bottomLeft.color.b - avgColor.b, 2)
      ),
      Math.sqrt(
        Math.pow(bottomRight.color.r - avgColor.r, 2) +
        Math.pow(bottomRight.color.g - avgColor.g, 2) +
        Math.pow(bottomRight.color.b - avgColor.b, 2)
      )
    ];
    
    const maxColorDev = Math.max(...colorDevs);
    
    // If the region is similar enough, use a 2x2 tile
    const BRIGHTNESS_THRESHOLD = 0.1; // Max allowed brightness difference
    const COLOR_THRESHOLD = 0.15;    // Max allowed color difference
    
    if (maxBrightnessDev < BRIGHTNESS_THRESHOLD && maxColorDev < COLOR_THRESHOLD) {
      size = 2;
      
      // Check if we can create a 4x4 tile
      if (maxTileSize >= 4 && 
          startX + 3 < xTileCount && 
          startY + 3 < yTileCount) {
        
        // Check if the 4x4 region is consistent
        let consistent = true;
        let totalBrightness = 0;
        let totalR = 0, totalG = 0, totalB = 0;
        let count = 0;
        
        for (let y = startY; y < startY + 4; y++) {
          for (let x = startX; x < startX + 4; x++) {
            if (y >= imageData.length || x >= imageData[0].length) {
              consistent = false;
              break;
            }
            const cell = imageData[y][x];
            totalBrightness += cell.brightness;
            totalR += cell.color.r;
            totalG += cell.color.g;
            totalB += cell.color.b;
            count++;
          }
          if (!consistent) break;
        }
        
        if (consistent) {
          const avg4x4Brightness = totalBrightness / count;
          const avg4x4Color = {
            r: totalR / count,
            g: totalG / count,
            b: totalB / count
          };
          
          // Check all cells for consistency with the 4x4 average
          let isConsistent4x4 = true;
          for (let y = startY; y < startY + 4 && isConsistent4x4; y++) {
            for (let x = startX; x < startX + 4 && isConsistent4x4; x++) {
              const cell = imageData[y][x];
              const brightnessDiff = Math.abs(cell.brightness - avg4x4Brightness);
              const colorDiff = Math.sqrt(
                Math.pow(cell.color.r - avg4x4Color.r, 2) +
                Math.pow(cell.color.g - avg4x4Color.g, 2) +
                Math.pow(cell.color.b - avg4x4Color.b, 2)
              );
              
              if (brightnessDiff > BRIGHTNESS_THRESHOLD || colorDiff > COLOR_THRESHOLD) {
                isConsistent4x4 = false;
              }
            }
          }
          
          if (isConsistent4x4) {
            size = 4;
            return { 
              size: 4, 
              averageBrightness: avg4x4Brightness,
              averageColor: avg4x4Color
            };
          }
        }
      }
      
      return { 
        size: 2, 
        averageBrightness: avgBrightness,
        averageColor: avgColor
      };
    }
  }
  
  // Return 1x1 if we can't use a larger size
  const cell = imageData[startY][startX];
  return { 
    size: 1, 
    averageBrightness: cell.brightness,
    averageColor: cell.color
  };
}

// Determine max tile size from config
function getMaxTileSize(tileSizeVariation: string): number {
  switch (tileSizeVariation) {
    case '4x': return 4;
    case '2x': return 2;
    default: return 1;
  }
}

// Update the createMosaic function to prevent overlapping tiles
async function createMosaic(
  selectedImage: SceneNode, 
  componentLibrary: ComponentData[], 
  config: MosaicConfig, 
  imageData: CellData[][]
) {
  try {
    console.log(`Creating mosaic with ${componentLibrary.length} components`);
    
    // Create a frame to hold the mosaic
    const mosaicGroup = figma.createFrame();
    mosaicGroup.name = 'Mosaic';
    
    // Calculate dimensions based on column count instead of tile size
    const width = selectedImage.width * config.enlargement;
    const height = selectedImage.height * config.enlargement;
    mosaicGroup.resize(width, height);
    
    // Position the frame
    mosaicGroup.x = selectedImage.x;
    mosaicGroup.y = selectedImage.y + selectedImage.height + 20;
    
    // Add to current page first so any errors are visible
    figma.currentPage.appendChild(mosaicGroup);
    console.log("Created mosaic frame");
    
    // Calculate grid based on requested column count
    const xTileCount = config.columnCount;
    const aspectRatio = selectedImage.height / selectedImage.width;
    const yTileCount = Math.round(xTileCount * aspectRatio);
    
    if (xTileCount <= 0 || yTileCount <= 0) {
      figma.notify(`Unable to create mosaic: invalid column count: ${xTileCount}`);
      mosaicGroup.remove();
      return;
    }
    
    // Calculate the tile size based on the desired column count
    const tileBaseSize = width / xTileCount;
    
    // Add tileBaseSize to config for reference in variations
    config.tileSizeBase = tileBaseSize;
    
    console.log(`Creating ${xTileCount}x${yTileCount} mosaic grid with size variation: ${config.tileSizeVariation}`);
    console.log(`Base tile size: ${tileBaseSize}px`);
    
    // Get maximum tile size from config
    const maxTileSize = getMaxTileSize(config.tileSizeVariation);
    
    // Count tiles for progress
    let completedTiles = 0;
    const totalTiles = xTileCount * yTileCount;
    
    // Map of how many times each component has been used
    const componentUsage = new Map<string, number>();
    
    // Verify data dimensions
    if (imageData.length === 0 || imageData[0].length === 0) {
      console.error("Image data is empty!");
      figma.notify("Error: Image data is invalid");
      mosaicGroup.remove();
      return;
    }
    
    // Create a grid to track which cells are already filled
    // This will be our primary source of truth for occupied cells
    const occupiedGrid: boolean[][] = [];
    for (let y = 0; y < yTileCount; y++) {
      occupiedGrid[y] = [];
      for (let x = 0; x < xTileCount; x++) {
        occupiedGrid[y][x] = false;
      }
    }
    
    // Process grid cells with potential for larger tiles
    for (let y = 0; y < yTileCount; y++) {
      // Let the UI update between rows
      if (y > 0 && y % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      
      for (let x = 0; x < xTileCount; x++) {
        // Skip if this cell is already occupied
        if (occupiedGrid[y][x]) continue;
        
        try {
          // Map x,y coordinates to data map indices
          const mapX = Math.min(imageData[0].length - 1, Math.floor(x * imageData[0].length / xTileCount));
          const mapY = Math.min(imageData.length - 1, Math.floor(y * imageData.length / yTileCount));
          
          // Check if we can fit larger tiles 
          // (don't even try if surrounding cells are occupied)
          let availableSize = 1;
          
          if (maxTileSize >= 2) {
            // Check if a 2x2 area is available
            if (x + 1 < xTileCount && y + 1 < yTileCount && 
                !occupiedGrid[y][x+1] && !occupiedGrid[y+1][x] && !occupiedGrid[y+1][x+1]) {
              availableSize = 2;
              
              // Check if a 4x4 area is available
              if (maxTileSize >= 4 && x + 3 < xTileCount && y + 3 < yTileCount) {
                let area4x4Available = true;
                
                // Check if the entire 4x4 area is available
                for (let dy = 0; dy < 4 && area4x4Available; dy++) {
                  for (let dx = 0; dx < 4 && area4x4Available; dx++) {
                    if (y + dy >= yTileCount || x + dx >= xTileCount || occupiedGrid[y + dy][x + dx]) {
                      area4x4Available = false;
                    }
                  }
                }
                
                if (area4x4Available) {
                  availableSize = 4;
                }
              }
            }
          }
          
          // Now, determine if the available area is visually consistent
          const { size, averageBrightness, averageColor } = determineTileSizeByContent(
            imageData, // This is already CellData[][], so it matches now
            mapX, 
            mapY, 
            Math.min(imageData[0].length, xTileCount),
            Math.min(imageData.length, yTileCount),
            availableSize // Limit by what's physically available in the grid
          );
          
          // Mark all covered cells as occupied
          for (let dy = 0; dy < size; dy++) {
            for (let dx = 0; dx < size; dx++) {
              if (y + dy < yTileCount && x + dx < xTileCount) {
                occupiedGrid[y + dy][x + dx] = true;
              }
            }
          }
          
          // Create a cell data object with the average values
          const cellData = {
            brightness: averageBrightness,
            color: averageColor,
            transparencyRatio: 0 // Not needed for matching
          };
          
          // Find the best matching component
          let bestMatch = componentLibrary[0].component;
          let bestScore = Number.MAX_VALUE;
          
          // Score each component
          for (const compData of componentLibrary) {
            // Calculate brightness difference (weighted at 60%)
            const brightnessDiff = Math.abs(cellData.brightness - compData.brightness);
            
            // Calculate color difference (weighted at 40%)
            // Using color distance formula
            const colorDiff = Math.sqrt(
              Math.pow(cellData.color.r - compData.color.r, 2) +
              Math.pow(cellData.color.g - compData.color.g, 2) +
              Math.pow(cellData.color.b - compData.color.b, 2)
            ) / Math.sqrt(3); // Normalized to 0-1
            
            // Combined score (lower is better)
            const score = brightnessDiff * 0.6 + colorDiff * 0.4;
            
            // Apply a small penalty for overused components
            const usageCount = componentUsage.get(compData.component.id) || 0;
            const usagePenalty = Math.min(usageCount * 0.01, 0.1); // Cap the penalty
            
            if (score + usagePenalty < bestScore) {
              bestScore = score + usagePenalty;
              bestMatch = compData.component;
            }
          }
          
          // Create component instance
          const instance = bestMatch.createInstance();
          instance.x = x * tileBaseSize;
          instance.y = y * tileBaseSize;
          
          // Resize instance based on the tile size we determined
          const tileWidth = size * tileBaseSize;
          const tileHeight = size * tileBaseSize;
          instance.resize(tileWidth, tileHeight);
          
          mosaicGroup.appendChild(instance);
          
          // Update component usage
          const currentUsage = componentUsage.get(bestMatch.id) || 0;
          componentUsage.set(bestMatch.id, currentUsage + 1);
          
          // Update progress (count by area covered)
          completedTiles += size * size;
          if (completedTiles % 50 === 0 || completedTiles >= totalTiles) {
            figma.notify(`Creating mosaic: ${Math.min(100, Math.round((completedTiles / totalTiles) * 100))}%`, {timeout: 500});
          }
        } catch (error) {
          console.error(`Error processing tile at (${x}, ${y}):`, error);
        }
      }
    }
    
    // Calculate statistics about component usage
    const uniqueComponentsUsed = componentUsage.size;
    let mostUsedComponent = '';
    let maxUseCount = 0;
    
    componentUsage.forEach((count, id) => {
      if (count > maxUseCount) {
        maxUseCount = count;
        mostUsedComponent = id;
      }
    });
    
    const mostUsedName = componentLibrary.find(c => c.component.id === mostUsedComponent)?.component.name || 'Unknown';
    
    // Final notification
    figma.notify(`Mosaic created using ${uniqueComponentsUsed} different components.`);
    
    // Create variations if requested
    if (config.variationCount > 1) {
      await createMosaicVariations(
        mosaicGroup, 
        imageData, 
        componentLibrary, 
        config,
        xTileCount,
        yTileCount,
        config.variationCount
      );
    }
    
  } catch (error) {
    console.error("Error creating mosaic:", error);
    figma.notify("Error creating mosaic. See console for details.");
  }
}

// Rename this function to be more specific about what it's checking and update its parameters
function determineTileSizeByContent(
  imageData: CellData[][], // Changed from CellData[] to CellData[][] 
  startX: number, 
  startY: number, 
  xTileCount: number,
  yTileCount: number,
  maxTileSize: number
): { size: number, averageBrightness: number, averageColor: {r: number, g: number, b: number} } {
  // Default to 1x1
  let size = 1;
  
  // If we don't allow larger tiles, return 1x1
  if (maxTileSize <= 1 || startY >= imageData.length || startX >= imageData[0].length) {
    const cell = imageData[startY][startX];
    return { 
      size: 1, 
      averageBrightness: cell.brightness,
      averageColor: cell.color
    };
  }
  
  // Check if we can create a 2x2 tile
  if (maxTileSize >= 2 && 
      startX + 1 < imageData[0].length && 
      startY + 1 < imageData.length) {
    
    // Get the 4 cells that would form a 2x2 tile
    const topLeft = imageData[startY][startX];
    const topRight = imageData[startY][startX + 1];
    const bottomLeft = imageData[startY + 1][startX];
    const bottomRight = imageData[startY + 1][startX + 1];
    
    // Calculate the brightness variance
    const brightnesses = [
      topLeft.brightness,
      topRight.brightness,
      bottomLeft.brightness,
      bottomRight.brightness
    ];
    
    const avgBrightness = brightnesses.reduce((sum, b) => sum + b, 0) / 4;
    
    // Calculate max deviation from average brightness
    const maxBrightnessDev = Math.max(
      ...brightnesses.map(b => Math.abs(b - avgBrightness))
    );
    
    // Calculate color variance
    const avgColor = {
      r: (topLeft.color.r + topRight.color.r + bottomLeft.color.r + bottomRight.color.r) / 4,
      g: (topLeft.color.g + topRight.color.g + bottomLeft.color.g + bottomRight.color.g) / 4,
      b: (topLeft.color.b + topRight.color.b + bottomLeft.color.b + bottomRight.color.b) / 4
    };
    
    const colorDevs = [
      Math.sqrt(
        Math.pow(topLeft.color.r - avgColor.r, 2) +
        Math.pow(topLeft.color.g - avgColor.g, 2) +
        Math.pow(topLeft.color.b - avgColor.b, 2)
      ),
      Math.sqrt(
        Math.pow(topRight.color.r - avgColor.r, 2) +
        Math.pow(topRight.color.g - avgColor.g, 2) +
        Math.pow(topRight.color.b - avgColor.b, 2)
      ),
      Math.sqrt(
        Math.pow(bottomLeft.color.r - avgColor.r, 2) +
        Math.pow(bottomLeft.color.g - avgColor.g, 2) +
        Math.pow(bottomLeft.color.b - avgColor.b, 2)
      ),
      Math.sqrt(
        Math.pow(bottomRight.color.r - avgColor.r, 2) +
        Math.pow(bottomRight.color.g - avgColor.g, 2) +
        Math.pow(bottomRight.color.b - avgColor.b, 2)
      )
    ];
    
    const maxColorDev = Math.max(...colorDevs);
    
    // If the region is similar enough, use a 2x2 tile
    const BRIGHTNESS_THRESHOLD = 0.1; // Max allowed brightness difference
    const COLOR_THRESHOLD = 0.15;    // Max allowed color difference
    
    if (maxBrightnessDev < BRIGHTNESS_THRESHOLD && maxColorDev < COLOR_THRESHOLD) {
      size = 2;
      
      // Check if we can create a 4x4 tile
      if (maxTileSize >= 4 && 
          startX + 3 < imageData[0].length && 
          startY + 3 < imageData.length) {
        
        // Check if the 4x4 region is consistent
        let consistent = true;
        let totalBrightness = 0;
        let totalR = 0, totalG = 0, totalB = 0;
        let count = 0;
        
        for (let y = startY; y < startY + 4; y++) {
          for (let x = startX; x < startX + 4; x++) {
            if (y >= imageData.length || x >= imageData[0].length) {
              consistent = false;
              break;
            }
            const cell = imageData[y][x];
            totalBrightness += cell.brightness;
            totalR += cell.color.r;
            totalG += cell.color.g;
            totalB += cell.color.b;
            count++;
          }
          if (!consistent) break;
        }
        
        if (consistent) {
          const avg4x4Brightness = totalBrightness / count;
          const avg4x4Color = {
            r: totalR / count,
            g: totalG / count,
            b: totalB / count
          };
          
          // Check all cells for consistency with the 4x4 average
          let isConsistent4x4 = true;
          for (let y = startY; y < startY + 4 && isConsistent4x4; y++) {
            for (let x = startX; x < startX + 4 && isConsistent4x4; x++) {
              const cell = imageData[y][x];
              const brightnessDiff = Math.abs(cell.brightness - avg4x4Brightness);
              const colorDiff = Math.sqrt(
                Math.pow(cell.color.r - avg4x4Color.r, 2) +
                Math.pow(cell.color.g - avg4x4Color.g, 2) +
                Math.pow(cell.color.b - avg4x4Color.b, 2)
              );
              
              if (brightnessDiff > BRIGHTNESS_THRESHOLD || colorDiff > COLOR_THRESHOLD) {
                isConsistent4x4 = false;
              }
            }
          }
          
          if (isConsistent4x4) {
            size = 4;
            return { 
              size: 4, 
              averageBrightness: avg4x4Brightness,
              averageColor: avg4x4Color
            };
          }
        }
      }
      
      return { 
        size: 2, 
        averageBrightness: avgBrightness,
        averageColor: avgColor
      };
    }
  }
  
  // Return 1x1 if we can't use a larger size
  const cell = imageData[startY][startX];
  return { 
    size: 1, 
    averageBrightness: cell.brightness,
    averageColor: cell.color
  };
}

// Function to collect component variants
function getComponentVariants(component: ComponentNode | ComponentSetNode, useVariants: boolean): ComponentNode[] {
  const components: ComponentNode[] = [];
  
  if (component.type === 'COMPONENT') {
    // Single component with no variants
    components.push(component);
  } else if (component.type === 'COMPONENT_SET' && useVariants) {
    // Component set with variants - add all variants if requested
    component.children.forEach(child => {
      if (child.type === 'COMPONENT') {
        components.push(child);
      }
    });
  } else if (component.type === 'COMPONENT_SET' && !useVariants) {
    // Just use the default variant if not using all variants
    const defaultVariant = component.defaultVariant;
    if (defaultVariant) {
      components.push(defaultVariant);
    } else if (component.children.length > 0) {
      // Fall back to first variant if no default
      const firstChild = component.children[0];
      if (firstChild.type === 'COMPONENT') {
        components.push(firstChild);
      }
    }
  }
  
  return components;
}

// Function to get component sets from current page only
function getCurrentPageComponents() {
  const componentsList: Array<{id: string, name: string}> = [];
  
  try {
    // Find component sets in the current page
    const componentSets = figma.currentPage.findAll(node => node.type === 'COMPONENT_SET') as ComponentSetNode[];
    componentSets.forEach(set => {
      componentsList.push({
        id: set.id,
        name: set.name + ' (Component Set)'
      });
    });
    
    // Also find standalone components (those without variants)
    const standaloneComponents = figma.currentPage.findAll(
      node => node.type === 'COMPONENT' && node.parent?.type !== 'COMPONENT_SET'
    ) as ComponentNode[];
    
    standaloneComponents.forEach(component => {
      componentsList.push({
        id: component.id,
        name: component.name
      });
    });
  } catch (error) {
    console.error('Error getting components from current page:', error);
  }
  
  return componentsList;
}

// Update the main message handler
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'get-current-page-components') {
    // Send list of components from current page to UI
    figma.ui.postMessage({
      type: 'current-page-components',
      components: getCurrentPageComponents()
    });
  } 
  else if (msg.type === 'create-mosaic') {
    const config: MosaicConfig = msg.config;
    console.log('Received config:', config);

    // Get selected nodes
    const selection = figma.currentPage.selection;
    
    if (selection.length === 0) {
      figma.notify('Please select an image');
      return;
    }
    
    if (!config.componentId) {
      figma.notify('Please select a component');
      return;
    }

    // Find the selected component
    const component = figma.getNodeById(config.componentId);
    if (!component || (component.type !== 'COMPONENT' && component.type !== 'COMPONENT_SET')) {
      figma.notify('Invalid component selected');
      return;
    }
    
    // Ensure column count is at least 1
    config.columnCount = Math.max(1, config.columnCount || 32);
    
    // Get component variants based on configuration
    const rawComponentLibrary = getComponentVariants(
      component as ComponentNode | ComponentSetNode, 
      config.useComponentVariants
    );
    
    if (rawComponentLibrary.length === 0) {
      figma.notify('No valid components found');
      return;
    }
    
    console.log(`Using ${rawComponentLibrary.length} component variants`);
    figma.notify(`Creating mosaic using ${rawComponentLibrary.length} component variants...`);
    
    try {
      // Show processing message
      figma.notify("Analyzing image...");
      
      // Get image data using UI context processing with the column count grid
      console.log("Getting image data...");
      const imageData = await getImageData(selection[0], config);
      
      // Process components to get brightness and color values
      console.log("Getting component data...");
      const componentLibrary = await getComponentData(rawComponentLibrary, config);
      
      // Create the mosaic with the processed data
      console.log("Creating mosaic...");
      await createMosaic(selection[0], componentLibrary, config, imageData);
      
    } catch (error) {
      console.error('Error creating mosaic:', error);
      figma.notify('Error creating mosaic. See console for details.');
    }
  }
  
  // These handlers are not needed since we're using promises with closures
  else if (msg.type === 'image-data-result') {
    console.log('Received image data from UI (main handler)');
    // This will be handled by the Promise in getImageData
  }
  
  else if (msg.type === 'component-data-result') {
    console.log(`Received data for component ${msg.componentId} (main handler)`);
    // This will be handled by the Promise in getComponentData
  }
};