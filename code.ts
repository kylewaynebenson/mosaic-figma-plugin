// Mosaic Plugin for Figma - Improved implementation with Canvas API brightness calculation

interface MosaicConfig {
  tileSize: number;
  componentId?: string;
  enlargement: number;
  matchResolution: number;
  useComponentVariants: boolean;
}

// Main plugin code
figma.showUI(__html__, { width: 240, height: 350 });

// Type guard to check if node has fills
function hasFills(node: SceneNode): node is SceneNode & { fills: ReadonlyArray<Paint> } {
  return 'fills' in node && Array.isArray(node.fills);
}

// Create a brightness map from the selected image
async function getBrightnessMap(
  node: SceneNode,
  gridSize: { width: number, height: number },
  resolution: number
): Promise<number[][]> {
  // Export the image as PNG
  let bytes: Uint8Array;
  try {
    bytes = await node.exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: 1 }
    });
  } catch (error) {
    console.error('Failed to export image:', error);
    // Create a fallback brightness map with default values
    const result: number[][] = [];
    for (let y = 0; y < gridSize.height; y++) {
      result[y] = [];
      for (let x = 0; x < gridSize.width; x++) {
        const relativeX = x / gridSize.width;
        const relativeY = y / gridSize.height;
        // Create a simple gradient fallback
        result[y][x] = 0.3 + relativeX * 0.4 + relativeY * 0.3;
      }
    }
    return result;
  }
  
  // Process the image data in UI context where Canvas API is available
  figma.ui.postMessage({
    type: 'process-image',
    bytes,
    gridSize,
    resolution
  });
  
  console.log("Sent image to UI for processing");
  
  // Return a Promise that will resolve when UI sends back the result
  return new Promise((resolve) => {
    const handler = (msg: any) => {
      if (msg.type === 'brightness-map-result' && msg.brightnessMap) {
        console.log("Received brightness map from UI");
        figma.ui.off('message', handler);
        resolve(msg.brightnessMap);
      }
    };
    
    figma.ui.on('message', handler);
    
    // Add timeout for fallback
    setTimeout(() => {
      console.log("Timeout waiting for brightness map");
      figma.ui.off('message', handler);
      
      // Create a fallback brightness map
      const result: number[][] = [];
      for (let y = 0; y < gridSize.height; y++) {
        result[y] = [];
        for (let x = 0; x < gridSize.width; x++) {
          const relativeX = x / gridSize.width;
          const relativeY = y / gridSize.height;
          result[y][x] = 0.3 + relativeX * 0.4 + relativeY * 0.3;
        }
      }
      resolve(result);
    }, 10000); // 10 second timeout
  });
}

// Get brightness values for all components by processing them as images
async function getComponentBrightnesses(
  components: ComponentNode[]
): Promise<Array<{component: ComponentNode, brightness: number}>> {
  figma.notify(`Analyzing ${components.length} components...`, { timeout: 1000 });
  
  // Create array to hold component data
  const componentData: Array<{component: ComponentNode, brightness: number}> = [];
  const pendingResults = new Map<string, {
    component: ComponentNode,
    resolve: (brightness: number) => void
  }>();
  
  // Set up message handler
  const messageHandler = (msg: any) => {
    if (msg.type === 'component-brightness-result' && msg.componentId) {
      const pending = pendingResults.get(msg.componentId);
      if (pending) {
        console.log(`Received brightness for ${msg.componentId}: ${msg.brightness}`);
        pending.resolve(msg.brightness);
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
      
      // Calculate brightness using UI
      const brightness = await new Promise<number>((resolve) => {
        pendingResults.set(component.id, { component, resolve });
        
        figma.ui.postMessage({
          type: 'process-component',
          componentId: component.id,
          bytes
        });
        
        // Add timeout for this component
        setTimeout(() => {
          if (pendingResults.has(component.id)) {
            console.log(`Timeout for component ${component.id}`);
            pendingResults.delete(component.id);
            resolve(0.5); // Default brightness
          }
        }, 5000); // 5 second timeout per component
      });
      
      return { component, brightness };
    } catch (error) {
      console.error(`Error processing component ${component.name}:`, error);
      return { component, brightness: 0.5 }; // Default brightness on error
    }
  });
  
  // Wait for all promises to resolve
  const results = await Promise.all(promises);
  
  // Clean up
  figma.ui.off('message', messageHandler);
  
  return results;
}

// Create the mosaic using brightness data and components
async function createMosaic(
  selectedImage: SceneNode, 
  componentLibrary: Array<{component: ComponentNode, brightness: number}>, 
  config: MosaicConfig, 
  brightnessMap: number[][]
) {
  try {
    // Sort components by brightness
    componentLibrary.sort((a, b) => a.brightness - b.brightness);
    console.log("Components sorted by brightness:", 
      componentLibrary.map(c => `${c.component.name}: ${c.brightness.toFixed(2)}`).join(', '));
    
    // Get min and max brightness from components
    const minBrightness = componentLibrary[0]?.brightness || 0;
    const maxBrightness = componentLibrary[componentLibrary.length - 1]?.brightness || 1;
    console.log(`Component brightness range: ${minBrightness.toFixed(2)} to ${maxBrightness.toFixed(2)}`);
    
    // Create a frame to hold the mosaic
    const mosaicGroup = figma.createFrame();
    mosaicGroup.name = 'Mosaic';
    
    // Calculate dimensions
    const width = selectedImage.width * config.enlargement;
    const height = selectedImage.height * config.enlargement;
    mosaicGroup.resize(width, height);
    
    // Position the frame
    mosaicGroup.x = selectedImage.x;
    mosaicGroup.y = selectedImage.y + selectedImage.height + 20;
    
    // Add to current page first so any errors are visible
    figma.currentPage.appendChild(mosaicGroup);
    
    // Calculate tile count
    const xTileCount = Math.floor(width / config.tileSize);
    const yTileCount = Math.floor(height / config.tileSize);
    
    if (xTileCount <= 0 || yTileCount <= 0) {
      figma.notify(`Unable to create mosaic: tile count would be ${xTileCount}x${yTileCount}`);
      mosaicGroup.remove();
      return;
    }
    
    console.log(`Creating ${xTileCount}x${yTileCount} mosaic grid`);
    
    // Count tiles for progress
    let completedTiles = 0;
    const totalTiles = xTileCount * yTileCount;
    
    // Process in batches to prevent UI freezing
    const BATCH_SIZE = 20;
    
    // Map of how many times each component has been used
    const componentUsage = new Map<string, number>();
    
    for (let y = 0; y < yTileCount; y++) {
      for (let batchStartX = 0; batchStartX < xTileCount; batchStartX += BATCH_SIZE) {
        const batchEndX = Math.min(batchStartX + BATCH_SIZE, xTileCount);
        
        // Process this batch
        for (let x = batchStartX; x < batchEndX; x++) {
          try {
            // Get brightness for this position
            // Map x,y coordinates to brightness map indices
            const mapX = Math.min(brightnessMap[0].length - 1, Math.floor(x * brightnessMap[0].length / xTileCount));
            const mapY = Math.min(brightnessMap.length - 1, Math.floor(y * brightnessMap.length / yTileCount));
            const brightness = brightnessMap[mapY][mapX];
            
            // For each position, find the component with the closest brightness
            let bestMatch = componentLibrary[0].component;
            let bestDifference = Math.abs(brightness - componentLibrary[0].brightness);
            
            // Simple linear search to find best match
            for (const { component, brightness: compBrightness } of componentLibrary) {
              const difference = Math.abs(brightness - compBrightness);
              
              // Apply a small penalty for overused components
              const usageCount = componentUsage.get(component.id) || 0;
              const usagePenalty = Math.min(usageCount * 0.01, 0.1); // Cap the penalty
              
              if (difference + usagePenalty < bestDifference) {
                bestDifference = difference;
                bestMatch = component;
              }
            }
            
            // Create component instance
            const instance = bestMatch.createInstance();
            instance.x = x * config.tileSize;
            instance.y = y * config.tileSize;
            instance.resize(config.tileSize, config.tileSize);
            mosaicGroup.appendChild(instance);
            
            // Update component usage
            const currentUsage = componentUsage.get(bestMatch.id) || 0;
            componentUsage.set(bestMatch.id, currentUsage + 1);
            
            // Update progress
            completedTiles++;
            if (completedTiles % 50 === 0 || completedTiles === totalTiles) {
              figma.notify(`Creating mosaic: ${Math.round((completedTiles / totalTiles) * 100)}%`, {timeout: 500});
            }
          } catch (error) {
            console.error(`Error processing tile at (${x}, ${y}):`, error);
          }
        }
        
        // Let the UI update between batches
        await new Promise(resolve => setTimeout(resolve, 0));
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
    figma.notify(`Mosaic created with ${completedTiles} tiles using ${uniqueComponentsUsed} different components. Most used: "${mostUsedName}" (${maxUseCount} times)`);
    
  } catch (error) {
    console.error("Error creating mosaic:", error);
    figma.notify("Error creating mosaic. See console for details.");
  }
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

// Plugin UI message handler
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
    
    // Calculate grid size based on tile size and enlargement
    const selectedImage = selection[0];
    const gridWidth = Math.floor((selectedImage.width * config.enlargement) / config.tileSize);
    const gridHeight = Math.floor((selectedImage.height * config.enlargement) / config.tileSize);
    
    try {
      // Show processing message
      figma.notify("Analyzing image...");
      
      // Get brightness map from the image using UI context processing
      console.log("Getting brightness map...");
      const brightnessMap = await getBrightnessMap(
        selectedImage,
        { width: gridWidth, height: gridHeight },
        config.matchResolution
      );
      
      // Process components to get brightness values
      console.log("Getting component brightnesses...");
      const componentLibrary = await getComponentBrightnesses(rawComponentLibrary);
      
      // Create the mosaic with the processed data
      console.log("Creating mosaic...");
      await createMosaic(selectedImage, componentLibrary, config, brightnessMap);
      
    } catch (error) {
      console.error('Error creating mosaic:', error);
      figma.notify('Error creating mosaic. See console for details.');
    }
  }
  
  // These handlers are not needed since we're using promises with closures
  else if (msg.type === 'brightness-map-result') {
    console.log('Received brightness map from UI (main handler)');
    // This will be handled by the Promise in getBrightnessMap
  }
  
  else if (msg.type === 'component-brightness-result') {
    console.log(`Received brightness for component ${msg.componentId}: ${msg.brightness} (main handler)`);
    // This will be handled by the Promise in getComponentBrightnesses
  }
};