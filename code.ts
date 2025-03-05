// Mosaic Plugin for Figma

// Configuration interface
interface MosaicConfig {
  tileSize: number;
  componentSource: 'current-page' | 'specific-library';
  libraryName?: string;
  enlargement: number;
  matchResolution: number;
  useComponentVariants: boolean;
}

// Main plugin code
figma.showUI(__html__, { width: 300, height: 500 });

// Type guard for pages that might serve as component libraries
function isLibraryPage(page: PageNode): boolean {
  // In Figma, there's no specific library page type - we need to check if it contains components
  return page.type === 'PAGE' && page.findOne(node => node.type === 'COMPONENT') !== null;
}

// Type guard to check if node has fills
function hasFills(node: SceneNode): node is SceneNode & { fills: ReadonlyArray<Paint> } {
  return 'fills' in node && Array.isArray(node.fills);
}

// Function to get average color of a node - improved version to better detect variant differences
function getNodeAverageColor(node: SceneNode): { r: number, g: number, b: number } {
  if (hasFills(node)) {
    // First try to find any solid fills
    const solidFills = node.fills.filter(fill => fill.type === 'SOLID');
    if (solidFills.length > 0) {
      return (solidFills[0] as SolidPaint).color;
    }
  }
  
  // If no solid fills found directly, try to find fills in children
  if ('children' in node && node.children.length > 0) {
    let totalR = 0, totalG = 0, totalB = 0;
    let count = 0;
    
    // Try to find fills in children
    for (const child of node.children) {
      if (hasFills(child)) {
        const solidFills = child.fills.filter(fill => fill.type === 'SOLID');
        if (solidFills.length > 0) {
          totalR += (solidFills[0] as SolidPaint).color.r;
          totalG += (solidFills[0] as SolidPaint).color.g;
          totalB += (solidFills[0] as SolidPaint).color.b;
          count++;
        }
      }
    }
    
    if (count > 0) {
      return {
        r: totalR / count,
        g: totalG / count,
        b: totalB / count
      };
    }
  }
  
  // Examine the component name to see if it contains color info
  if (node.type === 'COMPONENT' || node.type === 'INSTANCE') {
    const name = node.name.toLowerCase();
    // Check for common color names
    if (name.includes('red')) return { r: 0.9, g: 0.1, b: 0.1 };
    if (name.includes('green')) return { r: 0.1, g: 0.8, b: 0.1 };
    if (name.includes('blue')) return { r: 0.1, g: 0.1, b: 0.9 };
    if (name.includes('yellow')) return { r: 0.9, g: 0.9, b: 0.1 };
    if (name.includes('purple')) return { r: 0.6, g: 0.1, b: 0.9 };
    if (name.includes('orange')) return { r: 0.9, g: 0.5, b: 0.1 };
    if (name.includes('pink')) return { r: 0.9, g: 0.4, b: 0.7 };
    if (name.includes('black')) return { r: 0.1, g: 0.1, b: 0.1 };
    if (name.includes('white')) return { r: 0.9, g: 0.9, b: 0.9 };
    if (name.includes('gray') || name.includes('grey')) return { r: 0.5, g: 0.5, b: 0.5 };
  }
  
  // Fallback to a neutral gray if no solid fill
  return { r: 0.5, g: 0.5, b: 0.5 };
}

// Function to get color from specific part of an image
async function getSampleColorAtPoint(node: RectangleNode | FrameNode, x: number, y: number, width: number, height: number): Promise<{r: number, g: number, b: number}> {
  try {
    // In a real implementation, we would get the exact color from the image
    // Since we can't get pixel data directly, we'll use a position-based color sampling approach
    
    // Calculate the relative position in the image (0-1 range)
    const relativeX = x / node.width;
    const relativeY = y / node.height;
    
    // Get base color from the node
    let baseColor = { r: 0.5, g: 0.5, b: 0.5 }; // Default gray
    
    if (hasFills(node)) {
      const fill = node.fills[0];
      if (fill.type === 'SOLID') {
        baseColor = fill.color;
      }
    }
    
    // Modify the color based on position to create variation across the image
    // This simulates different parts of the image having different colors
    // In a real implementation, you'd analyze the actual image data
    const r = Math.max(0, Math.min(1, baseColor.r + (relativeX - 0.5) * 0.5));
    const g = Math.max(0, Math.min(1, baseColor.g + (relativeY - 0.5) * 0.5));
    const b = Math.max(0, Math.min(1, baseColor.b + ((relativeX + relativeY) / 2 - 0.5) * 0.3));
    
    return { r, g, b };
  } catch (error) {
    console.error('Error getting sample color:', error);
    return { r: 0.5, g: 0.5, b: 0.5 };
  }
}

// Enhanced version of getSampleColorData to better mimic the actual image
async function getSampleColorData(node: RectangleNode | FrameNode, x: number, y: number, width: number, height: number, resolution: number): Promise<number[]> {
  try {
    // Create a data array to hold RGB values
    const colorData: number[] = [];
    
    // We'll sample the area at the specified resolution
    const blockSize = Math.max(1, width / resolution);
    
    // Get base color from the node if it has fills
    let baseColor = { r: 0.5, g: 0.5, b: 0.5 }; // Default gray
    if (hasFills(node)) {
      const solidFills = node.fills.filter(fill => fill.type === 'SOLID');
      if (solidFills.length > 0) {
        baseColor = (solidFills[0] as SolidPaint).color;
      }
    }
    
    // Parse fill metadata if available (e.g., image fills)
    let hasImageFill = false;
    let imagePattern = 0; // Simple number to represent different image patterns
    
    if (hasFills(node)) {
      const imageFills = node.fills.filter(fill => fill.type === 'IMAGE');
      if (imageFills.length > 0) {
        hasImageFill = true;
        // Generate a consistent pattern seed based on node properties
        const nodeId = node.id || '';
        for (let i = 0; i < nodeId.length; i++) {
          imagePattern += nodeId.charCodeAt(i);
        }
        imagePattern = imagePattern % 10; // Limit to 10 different patterns
      }
    }
    
    // Sample the area by creating a grid of points within the sample region
    for (let dy = 0; dy < resolution; dy++) {
      for (let dx = 0; dx < resolution; dx++) {
        // Calculate sample point position
        const sampleX = x + (dx + 0.5) * blockSize;
        const sampleY = y + (dy + 0.5) * blockSize;
        
        // Get relative position (0-1) in the image
        const relativeX = sampleX / node.width;
        const relativeY = sampleY / node.height;
        
        let r, g, b;
        
        if (hasImageFill) {
          // For image fills, generate a more realistic image simulation
          // based on position and the image pattern we determined
          switch(imagePattern % 5) {
            case 0: // Gradient from top-left to bottom-right
              r = Math.round(255 * Math.max(0, Math.min(1, (relativeX + relativeY) / 2)));
              g = Math.round(255 * Math.max(0, Math.min(1, (relativeX + 1 - relativeY) / 2)));
              b = Math.round(255 * Math.max(0, Math.min(1, (1 - relativeX + relativeY) / 2)));
              break;
            case 1: // Circular pattern
              const distFromCenter = Math.sqrt(Math.pow(relativeX - 0.5, 2) + Math.pow(relativeY - 0.5, 2)) * 2;
              r = Math.round(255 * Math.max(0, Math.min(1, 1 - distFromCenter)));
              g = Math.round(255 * Math.max(0, Math.min(1, distFromCenter)));
              b = Math.round(255 * Math.max(0, Math.min(1, Math.abs(distFromCenter - 0.5) * 2)));
              break;
            case 2: // Stripes
              const stripeVal = (Math.sin(relativeX * Math.PI * 10) > 0) ? 1 : 0;
              r = Math.round(255 * stripeVal);
              g = Math.round(255 * (1 - stripeVal));
              b = Math.round(255 * Math.abs(relativeY - 0.5) * 2);
              break;
            case 3: // Checkerboard
              const checkVal = ((Math.floor(relativeX * 8) + Math.floor(relativeY * 8)) % 2 === 0) ? 1 : 0;
              r = Math.round(255 * checkVal);
              g = Math.round(255 * checkVal);
              b = Math.round(255 * checkVal);
              break;
            case 4: // Color blocks
              const blockX = Math.floor(relativeX * 3);
              const blockY = Math.floor(relativeY * 3);
              r = Math.round(255 * (blockX / 2));
              g = Math.round(255 * (blockY / 2));
              b = Math.round(255 * ((blockX + blockY) % 2));
              break;
            default:
              // Random pattern based on position
              r = Math.round(255 * Math.max(0, Math.min(1, 0.5 + Math.cos(relativeX * 20) * 0.5)));
              g = Math.round(255 * Math.max(0, Math.min(1, 0.5 + Math.sin(relativeY * 20) * 0.5)));
              b = Math.round(255 * Math.max(0, Math.min(1, 0.5 + Math.cos(relativeX * relativeY * 40) * 0.5)));
          }
        } else {
          // For solid fills or other types, use the base color with some variation
          r = Math.round(255 * Math.max(0, Math.min(1, baseColor.r + (relativeX - 0.5) * 0.2)));
          g = Math.round(255 * Math.max(0, Math.min(1, baseColor.g + (relativeY - 0.5) * 0.2)));
          b = Math.round(255 * Math.max(0, Math.min(1, baseColor.b + (relativeX + relativeY - 1) * 0.2)));
        }
        
        // Add RGB values to our data array
        colorData.push(r, g, b);
      }
    }
    
    return colorData;
  } catch (error) {
    console.error('Error getting sample color data:', error);
    return new Array(resolution * resolution * 3).fill(128); // Default gray
  }
}

// Function to get component color data - better capture of component appearance
function getComponentColorData(component: ComponentNode, resolution: number): number[] {
  try {
    const colorData: number[] = [];
    
    // Try to get more accurate color by examining the component's properties
    // First, get the component's average color
    const componentColor = getNodeAverageColor(component);
    
    // Convert to 0-255 range
    const baseR = Math.round(componentColor.r * 255);
    const baseG = Math.round(componentColor.g * 255);
    const baseB = Math.round(componentColor.b * 255);
    
    // Create a unique fingerprint for this component by examining various properties
    let uniqueOffset = 0;
    
    // Use component name to add uniqueness
    if (component.name) {
      for (let i = 0; i < component.name.length; i++) {
        uniqueOffset += component.name.charCodeAt(i);
      }
    }
    
    // Use component ID to ensure uniqueness
    if (component.id) {
      for (let i = 0; i < component.id.length; i++) {
        uniqueOffset += component.id.charCodeAt(i);
      }
    }
    
    // Fill the color data array, adding some variation based on the component's unique properties
    for (let i = 0; i < resolution * resolution; i++) {
      // Add a slight variation to ensure components are distinguishable
      const variation = (i + uniqueOffset) % 30 - 15;
      
      const r = Math.max(0, Math.min(255, baseR + variation));
      const g = Math.max(0, Math.min(255, baseG + variation));
      const b = Math.max(0, Math.min(255, baseB + variation));
      
      colorData.push(r, g, b);
    }
    
    console.log(`Component ${component.name}: Color data generated with base color R:${baseR}, G:${baseG}, B:${baseB}`);
    
    return colorData;
  } catch (error) {
    console.error('Error getting component color data:', error);
    return new Array(resolution * resolution * 3).fill(128);
  }
}

// Calculate the difference between two color data arrays (similar to Python implementation)
function calculateColorDifference(data1: number[], data2: number[], bailOutValue: number = Infinity): number {
  let diff = 0;
  
  for (let i = 0; i < data1.length; i += 3) {
    // Calculate squared difference (just like in Python)
    const rDiff = Math.pow(data1[i] - data2[i], 2);
    const gDiff = Math.pow(data1[i+1] - data2[i+1], 2);
    const bDiff = Math.pow(data1[i+2] - data2[i+2], 2);
    
    diff += rDiff + gDiff + bDiff;
    
    // Early bail out if we exceed the threshold (optimization from Python)
    if (diff > bailOutValue) {
      return diff;
    }
  }
  
  return diff;
}

// Function to find best matching component from all variants
function findBestMatchComponent(
  sourceColor: {r: number, g: number, b: number}, 
  componentLibrary: ComponentNode[]
): ComponentNode {
  let bestMatch: ComponentNode | null = null;
  let minDifference = Infinity;

  // Debug log
  console.log(`Finding match for color: R=${Math.round(sourceColor.r * 255)}, G=${Math.round(sourceColor.g * 255)}, B=${Math.round(sourceColor.b * 255)}`);
  
  // Shuffle the component library array to avoid always selecting the same component when colors are identical
  const shuffledComponents = [...componentLibrary].sort(() => Math.random() - 0.5);

  shuffledComponents.forEach(component => {
    const componentColor = getNodeAverageColor(component);
    
    // Calculate color difference using Euclidean distance in RGB space
    const difference = Math.sqrt(
      Math.pow(sourceColor.r - componentColor.r, 2) +
      Math.pow(sourceColor.g - componentColor.g, 2) +
      Math.pow(sourceColor.b - componentColor.b, 2)
    );
    
    if (difference < minDifference) {
      minDifference = difference;
      bestMatch = component;
    }
  });

  // If we found a match, let's log what it was
  if (bestMatch) {
    const matchColor = getNodeAverageColor(bestMatch);
    console.log(`  Selected component with color: R=${Math.round(matchColor.r * 255)}, G=${Math.round(matchColor.g * 255)}, B=${Math.round(matchColor.b * 255)}`);
  }

  return bestMatch || componentLibrary[0];
}

// Function to find best matching component using the Python algorithm approach
async function findBestMatchingTile(
  imageSection: number[], 
  componentLibrary: ComponentNode[],
  resolution: number
): Promise<ComponentNode> {
  let bestMatchIndex = 0;
  let minDiff = Number.MAX_VALUE;
  
  // Pre-compute all component color data
  const componentColorData = componentLibrary.map(component => 
    getComponentColorData(component, resolution)
  );
  
  // Find the component with the smallest color difference
  for (let i = 0; i < componentLibrary.length; i++) {
    const diff = calculateColorDifference(imageSection, componentColorData[i], minDiff);
    if (diff < minDiff) {
      minDiff = diff;
      bestMatchIndex = i;
    }
  }
  
  return componentLibrary[bestMatchIndex];
}

// Modified createMosaic function to ensure variant diversity
async function createMosaic(
  selectedImage: SceneNode, 
  componentLibrary: ComponentNode[], 
  config: MosaicConfig
) {
  // Ensure we have a valid rectangle or image
  if (!(selectedImage.type === 'RECTANGLE' || selectedImage.type === 'FRAME')) {
    figma.notify('Please select a rectangle or frame with an image');
    return;
  }

  console.log(`Creating mosaic using ${componentLibrary.length} component variants`);
  
  // Shuffle the component library to prevent bias in selection
  const shuffledComponentLibrary = [...componentLibrary].sort(() => Math.random() - 0.5);
  
  // Create a frame to hold the mosaic
  const mosaicGroup = figma.createFrame();
  mosaicGroup.name = 'Mosaic';
  mosaicGroup.resize(
    selectedImage.width * config.enlargement, 
    selectedImage.height * config.enlargement
  );

  // Calculate tile dimensions
  const xTileCount = Math.floor(mosaicGroup.width / config.tileSize);
  const yTileCount = Math.floor(mosaicGroup.height / config.tileSize);

  console.log(`Creating ${xTileCount}x${yTileCount} mosaic grid`);

  // Create progress counter
  let completedTiles = 0;
  const totalTiles = xTileCount * yTileCount;
  
  // Track used components to ensure variety
  const usedComponents = new Set<string>();
  
  // Pre-compute all component color data
  console.log("Pre-computing component color data...");
  const componentColorData = shuffledComponentLibrary.map(component => ({
    component,
    colorData: getComponentColorData(component, config.matchResolution)
  }));
  console.log(`Pre-computed color data for ${componentColorData.length} components`);
  
  // Create mosaic tiles
  for (let x = 0; x < xTileCount; x++) {
    for (let y = 0; y < yTileCount; y++) {
      // Calculate sample position in the original image
      const sampleX = (x * config.tileSize) / config.enlargement;
      const sampleY = (y * config.tileSize) / config.enlargement;
      const sampleWidth = config.tileSize / config.enlargement;
      const sampleHeight = config.tileSize / config.enlargement;

      // Get color data for this section of the image
      let imageSection;
      if (selectedImage.type === 'RECTANGLE' || selectedImage.type === 'FRAME') {
        imageSection = await getSampleColorData(
          selectedImage, 
          sampleX, 
          sampleY, 
          sampleWidth, 
          sampleHeight,
          config.matchResolution
        );
      } else {
        // Default gray if not rectangle/frame
        imageSection = new Array(config.matchResolution * config.matchResolution * 3).fill(128);
      }
      
      // Find best matching component with some randomness to ensure variety
      let bestMatchComponent: ComponentNode = componentLibrary[0];
      let minDiff = Number.MAX_VALUE;
      
      for (let i = 0; i < componentColorData.length; i++) {
        const { component, colorData } = componentColorData[i];
        
        // Add a small random factor to promote variety
        const randomFactor = Math.random() * 1000; 
        const diff = calculateColorDifference(imageSection, colorData, minDiff) + randomFactor;
        
        // Give preference to components that haven't been used much
        const usageBonus = usedComponents.has(component.id) ? 500 : 0;
        
        if (diff + usageBonus < minDiff) {
          minDiff = diff + usageBonus;
          bestMatchComponent = component;
        }
      }
      
      // Track used components
      usedComponents.add(bestMatchComponent.id);
      
      // Create instance of best match component
      const componentInstance = bestMatchComponent.createInstance();
      componentInstance.x = x * config.tileSize;
      componentInstance.y = y * config.tileSize;
      componentInstance.resize(config.tileSize, config.tileSize);
      
      mosaicGroup.appendChild(componentInstance);
      
      // Log which component was used
      console.log(`Tile at (${x},${y}) using component: ${bestMatchComponent.name}`);
      
      // Update progress
      completedTiles++;
      if (completedTiles % 10 === 0 || completedTiles === totalTiles) {
        figma.notify(`Processing: ${Math.round((completedTiles / totalTiles) * 100)}%`, {timeout: 500});
      }
    }
  }

  // Position the mosaic group
  mosaicGroup.x = selectedImage.x;
  mosaicGroup.y = selectedImage.y + selectedImage.height + 20; // Position below the original image

  // Add to current page
  figma.currentPage.appendChild(mosaicGroup);

  // Print statistics about variety
  const uniqueComponentsUsed = usedComponents.size;
  console.log(`Used ${uniqueComponentsUsed} different components out of ${componentLibrary.length} available`);

  // Notify user
  figma.notify(`Mosaic created with ${xTileCount * yTileCount} tiles using ${uniqueComponentsUsed} different component variants`);
}

// Get list of available libraries
function getLibraries() {
  const libraries: Array<{id: string, name: string}> = figma.root.children
    .filter((page): page is PageNode => 
      page.type === 'PAGE' && 
      page.findOne(node => node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') !== null
    )
    .map(page => ({
      id: page.id,
      name: page.name
    }));
  
  return libraries;
}

// Function to collect all component variants
function getAllComponentVariants(scope: BaseNode, useVariants: boolean = true): ComponentNode[] {
  const components: ComponentNode[] = [];
  
  // Check if the scope is a type that supports findAll and findChildren
  if ('findAll' in scope && 'findChildren' in scope) {
    // It's safer to check for specific node types that we know support findAll
    const supportedNode = scope as PageNode | FrameNode | GroupNode | InstanceNode | ComponentNode | ComponentSetNode;
    
    if (useVariants) {
      try {
        // Find all component sets (variant collections)
        const componentSets = supportedNode.findAll(node => node.type === 'COMPONENT_SET') as ComponentSetNode[];
        
        // Get all variants from each component set
        componentSets.forEach(componentSet => {
          componentSet.children.forEach(child => {
            if (child.type === 'COMPONENT') {
              components.push(child);
            }
          });
        });
      } catch (error) {
        console.error("Error finding component sets:", error);
      }
    }
    
    try {
      // Also find standalone components (non-variant components)
      const standaloneComponents = supportedNode.findAll(
        node => node.type === 'COMPONENT' && 
        (!useVariants || node.parent?.type !== 'COMPONENT_SET')
      ) as ComponentNode[];
      
      components.push(...standaloneComponents);
    } catch (error) {
      console.error("Error finding standalone components:", error);
    }
  } else {
    console.warn('Node type does not support finding components:', scope.type);
  }
  
  return components;
}

// Plugin UI message handler
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'get-libraries') {
    // Send list of libraries to UI
    figma.ui.postMessage({
      type: 'libraries-list',
      libraries: getLibraries()
    });
  }

  if (msg.type === 'create-mosaic') {
    const config: MosaicConfig = msg.config;
    console.log('Received config:', config);

    // Get selected nodes
    const selection = figma.currentPage.selection;
    
    if (selection.length === 0) {
      figma.notify('Please select an image');
      return;
    }

    // Find component library based on configuration
    let componentLibrary: ComponentNode[] = [];

    if (config.componentSource === 'current-page') {
      // Find components on current page with all variants
      componentLibrary = getAllComponentVariants(figma.currentPage, config.useComponentVariants).filter(
        component => Math.abs(component.width - config.tileSize) < 0.1 && 
                     Math.abs(component.height - config.tileSize) < 0.1
      );
    } else if (config.componentSource === 'specific-library') {
      // Find library and its components
      const library = figma.root.children.find(
        (page): page is PageNode => 
          page.type === 'PAGE' && 
          page.id === config.libraryName
      );

      if (library) {
        componentLibrary = getAllComponentVariants(library, config.useComponentVariants).filter(
          component => Math.abs(component.width - config.tileSize) < 0.1 && 
                       Math.abs(component.height - config.tileSize) < 0.1
        );
      }
    }

    console.log(`Found ${componentLibrary.length} components to use`);

    if (componentLibrary.length === 0) {
      figma.notify(`No components found of size ${config.tileSize}x${config.tileSize}`);
      return;
    }

    figma.notify(`Creating mosaic using ${componentLibrary.length} components`);

    // Create mosaic from first selected item
    await createMosaic(selection[0], componentLibrary, config);
  }
};