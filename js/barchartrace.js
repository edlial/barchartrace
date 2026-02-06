function createBarChartRace(data, top_n, tickDuration, options) {
    var data = data;
    let chartDiv = document.getElementById("chartDiv");
    chartDiv.textContent = '';
    let width = chartDiv.clientWidth;
    let height = chartDiv.clientHeight - 50;

    let svg = d3.select(chartDiv).append("svg")
        .attr("width", width)
        .attr("height", height);

    let timeline_svg = d3.select(chartDiv).append("svg")
        .attr("width", width)
        .attr("height", 50);

    // Read iconsLeftOfAxis option
    const iconsLeftOfAxis = options && options.iconsLeftOfAxis === true;
    console.log('iconsLeftOfAxis:', iconsLeftOfAxis, 'options:', options);
    
    // Minimum bar length: ensures labels are visible inside bars from the start
    const minBarLength = (options && options.minBarLength != null) ? options.minBarLength : 100;
    
    // Label margin: space on the left for bar labels when bars are short
    const labelMargin = (options && options.labelMargin != null) ? options.labelMargin : 0;
    
    // Right margin: space on the right for value labels
    const rightMargin = (options && options.rightMargin != null) ? options.rightMargin : 150;
    
    const margin = {
        top: 20,
        right: rightMargin,
        bottom: 0,
        left: iconsLeftOfAxis ? Math.max(80, labelMargin) : labelMargin  // Add left margin for labels
    };

    const marginTimeAxis = 30;

    let barPadding = (height - (margin.bottom + margin.top)) / (top_n * 5);

    // options (icons + styling)
    const resolvedOptions = options || {};
    const iconUrlByName = resolvedOptions.icons || {};
    const iconSize = resolvedOptions.iconSize || 18; // px
    const iconGap = resolvedOptions.iconGap != null ? resolvedOptions.iconGap : 8; // px to the right of bar end
    const labelPadding = resolvedOptions.labelPadding != null ? resolvedOptions.labelPadding : 10; // px inside bar end
    const numberGap = resolvedOptions.numberGap != null ? resolvedOptions.numberGap : 18; // px to the right of icon
    const showGridlines = resolvedOptions.showGridlines !== false; // default true
    const dynamicScaling = resolvedOptions.dynamicScaling === true; // default false
    const labelTextStyle = resolvedOptions.labelTextStyle || {};
    const valueTextStyle = resolvedOptions.valueTextStyle || {};
    const customColors = resolvedOptions.colors || null;
    const facts = resolvedOptions.facts || []; // Facts: array of {text, image, timepoint}

    const barEndX = (d) => x(d.value) + minBarLength; // exact end of bar (data value + minimum length)
    const hasIcon = (d) => Boolean(iconUrlByName[d.name]);
    const labelX = (d) => barEndX(d) - labelPadding; // text end just inside bar
    // Icon position: left of axis (before bar start) or right of bar end
    const iconX = (d) => iconsLeftOfAxis 
        ? 5  // Fixed position at left edge with small padding
        : (barEndX(d) + iconGap); // icon outside bar (to the right)
    // Value label position: when icons are on the left, don't account for icon space
    const valueLabelX = (d) => iconsLeftOfAxis
        ? (barEndX(d) + numberGap)
        : (hasIcon(d)
            ? (barEndX(d) + iconGap + iconSize + numberGap)
            : (barEndX(d) + numberGap));

    function getRowData(data, column_names, row_index) {
        const row = data[row_index];
        let new_data = column_names.map((name) => {
            return {name: name, value: row[name]}
        });
        new_data = new_data.sort((a, b) => b.value - a.value).slice(0, top_n);
        new_data.forEach((d, i) => {
            d.rank = i;
            d.lastValue = (row_index > 0) ? data[row_index - 1][d.name] : d.value;
        });
        return [row[d3.keys(row)[0]], new_data]
    }

    const time_index = d3.keys(data[0])[0];
    const column_names = d3.keys(data[0]).slice(1,);

    // define a random color for each column
    const colors = {};
    let color_scale;
    
    if (customColors && customColors.length > 0) {
        // Use custom colors
        color_scale = d3.scaleOrdinal(customColors);
    } else {
        // Use default D3 color scheme
        color_scale = d3.scaleOrdinal(d3.schemeSet3);
    }

    column_names.forEach((name, i) => {
        colors[name] = color_scale(i)
    });

    // Parse data
    data.forEach((d) => {
        // first column : YYYY-MM-DD
        const parseTime = d3.timeParse("%Y-%m-%d");
        d[time_index] = parseTime(d[time_index]);
        // convert other columns to numbers
        column_names.forEach((k) => d[k] = Number(d[k]))

    });

    // Calculate global maximum value across all time periods
    let globalMax = 0;
    data.forEach((d) => {
        column_names.forEach((k) => {
            if (d[k] > globalMax) {
                globalMax = d[k];
            }
        });
    });
    
    // Helper function to calculate max value for current time period
    function getCurrentMaxValue(row_data) {
        if (!dynamicScaling) return globalMax;
        return d3.max(row_data, d => d.value) || globalMax;
    }

    // draw the first frame

    [time, row_data] = getRowData(data, column_names, 0);

    start_date = d3.min(data, d => d[time_index]);
    end_date = d3.max(data, d => d[time_index]);

    let t = d3.scaleTime()
        .domain([start_date, end_date])
        .range([margin.left + marginTimeAxis, width - 80]); // Fixed right margin for timeline

    let timeAxis = d3.axisBottom()
        .ticks(5)
        .scale(t);

    let x = d3.scaleLinear()
        .domain([0, dynamicScaling ? getCurrentMaxValue(row_data) : globalMax])
        .range([margin.left, width - margin.right]);

    let y = d3.scaleLinear()
        .domain([top_n, 0])
        .range([height - margin.bottom, margin.top]);

    let xAxis = d3.axisTop()
        .scale(x)
        .ticks(5)
        .tickSize(showGridlines ? -(height - margin.top - margin.bottom) : 0)
        .tickFormat(showGridlines ? (d => d3.format(',')(d)) : (() => ''));

    // always create x-axis, but control visibility with CSS
    svg.append('g')
        .attr('class', 'axis xAxis')
        .attr('transform', `translate(0, ${margin.top})`)
        .call(xAxis)
        .selectAll('.tick line')
        .classed('origin', d => d === 0);

    // hide gridlines if disabled
    if (!showGridlines) {
        svg.select('.xAxis').style('display', 'none');
    }


    svg.selectAll('rect.bar')
        .data(row_data, d => d.name)
        .enter()
        .append('rect')
        .attr('class', 'bar')
        .attr('x', x(0) + 1)
        .attr('width', d => (x(d.value) - x(0)) + minBarLength)
        .attr('y', d => y(d.rank) + barPadding / 2)
        .attr('height', y(1) - y(0) - barPadding)
        .style('fill', d => colors[d.name]);


    const labelsSel = svg.selectAll('text.label')
        .data(row_data, d => d.name)
        .enter()
        .append('text')
        .attr('class', 'label')
        .attr('x', d => labelX(d))
        .attr('y', d => y(d.rank) + ((y(1) - y(0)) / 2) + 1)
        .style('text-anchor', 'end')
        .html(d => d.name);
    if (labelTextStyle.fontFamily) labelsSel.style('font-family', labelTextStyle.fontFamily);
    if (labelTextStyle.fontSize) labelsSel.style('font-size', labelTextStyle.fontSize + 'px');
    if (labelTextStyle.fill) labelsSel.style('fill', labelTextStyle.fill);

    // initial icons
    svg.selectAll('image.icon')
        .data(row_data.filter(d => hasIcon(d)), d => d.name)
        .enter()
        .append('image')
        .attr('class', 'icon')
        .attr('width', iconSize)
        .attr('height', iconSize)
        .attr('x', d => iconX(d))
        .attr('y', d => y(d.rank) + ((y(1) - y(0)) / 2) - iconSize / 2)
        .attr('href', d => iconUrlByName[d.name])
        .attr('xlink:href', d => iconUrlByName[d.name]);

    const valueSel = svg.selectAll('text.valueLabel')
        .data(row_data, d => d.name)
        .enter()
        .append('text')
        .attr('class', 'valueLabel')
    .attr('x', d => valueLabelX(d))
        .attr('y', d => y(d.rank) + ((y(1) - y(0)) / 2) + 1)
        .text(d => d3.format(',.0f')(d.lastValue));
    if (valueTextStyle.fontFamily) valueSel.style('font-family', valueTextStyle.fontFamily);
    if (valueTextStyle.fontSize) valueSel.style('font-size', valueTextStyle.fontSize + 'px');
    if (valueTextStyle.fill) valueSel.style('fill', valueTextStyle.fill);

    // svg.append('rect')
    //     .attr('y', height - margin.bottom)
    //     .attr('width', width)
    //     .attr('height', margin.bottom)
    //     .style('fill', '#ffffff')


    timeline_svg.append('g')
        .attr('class', 'axis tAxis')
        .attr('transform', `translate(0, 20)`)
        .call(timeAxis);

    timeline_svg.append('rect')
        .attr('class', 'progressBar')
        .attr('transform', `translate(${marginTimeAxis}, 20)`)
        .attr('height', 2)
        .attr('width', 0);

    let timeText = svg.append('text')
        .attr('class', 'timeText')
        .attr('x', width - 20) // Fixed right margin for date text
        .attr('y', height - margin.bottom - 5)
        .style('text-anchor', 'end')
        .html(d3.timeFormat("%B %d, %Y")(time));

    // Facts feature: create elements for displaying facts
    // Position: bottom right, above the timepoint text
    const factPadding = 15; // px between elements
    const factTextMaxWidth = resolvedOptions.factTextWidth || 300; // px for text wrapping
    const factFontSize = resolvedOptions.factFontSize || 24; // px font size
    
    // Calculate chart aspect ratio for image scaling
    // Reference aspect ratio is 16:9 (landscape) = ~1.78
    const chartAspectRatio = width / height;
    const referenceAspectRatio = 16 / 9;
    
    // Cache for loaded image dimensions
    const imageCache = {};
    
    // Function to load and cache image dimensions
    function loadImageDimensions(imageUrl) {
        return new Promise((resolve) => {
            if (imageCache[imageUrl]) {
                resolve(imageCache[imageUrl]);
                return;
            }
            const img = new Image();
            img.onload = function() {
                const dims = {
                    naturalWidth: img.naturalWidth,
                    naturalHeight: img.naturalHeight
                };
                imageCache[imageUrl] = dims;
                resolve(dims);
            };
            img.onerror = function() {
                // Default fallback dimensions if image fails to load
                resolve({ naturalWidth: 100, naturalHeight: 100 });
            };
            img.src = imageUrl;
        });
    }
    
    // Function to calculate scaled image dimensions based on aspect ratio changes
    function getScaledImageDimensions(naturalWidth, naturalHeight) {
        // When aspect ratio changes significantly (e.g., 16:9 to 9:16), scale the image
        // Scale factor based on how much the aspect ratio differs from reference
        let scaleFactor = 1;
        
        // Check if aspect ratio changed significantly (portrait vs landscape)
        const isPortrait = chartAspectRatio < 1;
        const isReferenceLandscape = referenceAspectRatio > 1;
        
        if (isPortrait !== isReferenceLandscape) {
            // Aspect ratio flipped (e.g., 16:9 to 9:16)
            // Scale proportionally based on the ratio change
            // For 9:16, the width is much smaller, so we scale down
            scaleFactor = Math.min(chartAspectRatio / referenceAspectRatio, 1);
            // But don't scale down too much - use square root to soften the scaling
            scaleFactor = Math.sqrt(scaleFactor);
        }
        
        // Return natural dimensions scaled by the factor
        return {
            width: Math.round(naturalWidth * scaleFactor),
            height: Math.round(naturalHeight * scaleFactor)
        };
    }
    
    // Track current image dimensions
    let currentImageWidth = 0;
    let currentImageHeight = 0;
    
    // Create a group for fact elements
    let factGroup = svg.append('g')
        .attr('class', 'factGroup')
        .style('opacity', 0); // Start hidden
    
    // Fact image element (positioned at bottom right, just above timeText)
    // Initial dimensions will be set when image loads
    let factImage = factGroup.append('image')
        .attr('class', 'factImage')
        .attr('x', width - 20)
        .attr('y', height - margin.bottom - 30)
        .attr('preserveAspectRatio', 'xMidYMid meet');
    
    // Fact text element (above the image)
    let factText = factGroup.append('text')
        .attr('class', 'factText')
        .attr('x', width - 20) // Right-aligned with timeText
        .attr('y', height - margin.bottom - 40 - factPadding) // Above the image
        .style('text-anchor', 'end')
        .style('font-size', factFontSize + 'px')
        .style('font-weight', '600')
        .style('fill', '#333333');
    
    // Variable to track current fact
    let currentFactIndex = -1;
    
    // Function to get the appropriate fact for current time
    function getFactForTime(currentTime) {
        if (!facts || facts.length === 0) return null;
        
        // Get the current year from the time
        const currentYear = currentTime.getFullYear();
        
        // Find the fact whose year has passed but is the most recent
        let bestFact = null;
        let bestFactIndex = -1;
        
        for (let i = 0; i < facts.length; i++) {
            const factYear = parseInt(facts[i].timepoint);
            if (factYear <= currentYear) {
                // This fact's year has passed
                if (bestFact === null || factYear > parseInt(bestFact.timepoint)) {
                    bestFact = facts[i];
                    bestFactIndex = i;
                }
            }
        }
        
        // If the best matching fact has no text and no image, it's a "hide" marker
        // Return null to hide the fact display
        if (bestFact && !bestFact.text && !bestFact.image) {
            return { fact: null, index: -1 };
        }
        
        return { fact: bestFact, index: bestFactIndex };
    }
    
    // Function to wrap text into multiple lines
    function wrapFactText(text, maxWidth) {
        const words = text.split(/\s+/);
        const lines = [];
        let currentLine = '';
        // Approximate characters per line based on width and font size
        const charsPerLine = Math.floor(maxWidth / (factFontSize * 0.6));
        
        words.forEach(word => {
            const testLine = currentLine ? currentLine + ' ' + word : word;
            if (testLine.length > charsPerLine) {
                if (currentLine) lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        });
        if (currentLine) lines.push(currentLine);
        
        return lines;
    }
    
    // Calculate line height based on font size
    const factLineHeight = Math.round(factFontSize * 1.3);
    
    // Function to update fact display
    function updateFactDisplay(currentTime) {
        const result = getFactForTime(currentTime);
        
        // Check if result is null (no facts defined) or no matching fact found
        if (!result || !result.fact) {
            // No fact to display - fade out the group
            if (currentFactIndex !== -1) {
                factGroup.transition()
                    .duration(400)
                    .style('opacity', 0);
            }
            currentFactIndex = -1;
            return;
        }
        
        // Only update if fact changed
        if (result.index !== currentFactIndex) {
            const isFirstFact = currentFactIndex === -1;
            currentFactIndex = result.index;
            
            // Function to show the new fact
            async function showNewFact() {
                // Update image if present
                if (result.fact.image) {
                    // Load image to get natural dimensions
                    const dims = await loadImageDimensions(result.fact.image);
                    const scaled = getScaledImageDimensions(dims.naturalWidth, dims.naturalHeight);
                    currentImageWidth = scaled.width;
                    currentImageHeight = scaled.height;
                    
                    factImage
                        .attr('href', result.fact.image)
                        .attr('width', currentImageWidth)
                        .attr('height', currentImageHeight)
                        .attr('x', width - 20 - currentImageWidth)
                        .attr('y', height - margin.bottom - 30 - currentImageHeight)
                        .style('display', 'block');
                } else {
                    factImage.style('display', 'none');
                    currentImageWidth = 0;
                    currentImageHeight = 0;
                }
                
                // Update text with wrapping
                factText.selectAll('tspan').remove();
                const lines = wrapFactText(result.fact.text, factTextMaxWidth);
                
                // Calculate Y position based on whether image is present
                const imageHeight = result.fact.image ? currentImageHeight + factPadding : 0;
                const textStartY = height - margin.bottom - 40 - imageHeight - (lines.length - 1) * factLineHeight;
                
                lines.forEach((line, i) => {
                    factText.append('tspan')
                        .attr('x', width - 20)
                        .attr('dy', i === 0 ? 0 : factLineHeight)
                        .text(line);
                });
                
                // Adjust text position
                factText.attr('y', textStartY);
                
                // Slide and fade in effect
                factGroup
                    .attr('transform', 'translate(20, 0)')
                    .style('opacity', 0)
                    .transition()
                    .duration(500)
                    .ease(d3.easeCubicOut)
                    .attr('transform', 'translate(0, 0)')
                    .style('opacity', 1);
            }
            
            if (isFirstFact) {
                // First fact - just fade in
                showNewFact();
            } else {
                // Transition: fade out old, then fade in new
                factGroup.transition()
                    .duration(300)
                    .ease(d3.easeCubicIn)
                    .style('opacity', 0)
                    .attr('transform', 'translate(-20, 0)')
                    .on('end', showNewFact);
            }
        }
    }
    
    // Initial fact display check
    updateFactDisplay(time);

    // draw the updated graph with transitions
    function drawGraph() {
        // Update x-axis domain if dynamic scaling is enabled
        if (dynamicScaling) {
            const currentMax = getCurrentMaxValue(row_data);
            x.domain([0, currentMax]);
        }
        
        // update x-axis
        svg.select('.xAxis')
            .transition()
            .duration(tickDuration)
            .ease(d3.easeLinear)
            .call(xAxis);

        // control visibility
        if (showGridlines) {
            svg.select('.xAxis').style('display', 'block');
        } else {
            svg.select('.xAxis').style('display', 'none');
        }

        // update bars
        let bars = svg.selectAll('.bar').data(row_data, d => d.name);

        bars.enter().append('rect')
            .attr('class', 'bar')
            .attr('x', x(0) + 1)
            .attr('width', d => (x(d.value) - x(0)) + minBarLength)
            //enter from out of screen
            .attr('y', d => y(top_n + 1) + 0)
            .attr('height', y(1) - y(0) - barPadding)
            .style('fill', d => colors[d.name])
            .transition()
            .duration(tickDuration)
            .ease(d3.easeLinear)
            .attr('y', d => y(d.rank) + barPadding / 2);

        bars.transition()
            .duration(tickDuration)
            .ease(d3.easeLinear)
            .attr('width', d => (x(d.value) - x(0)) + minBarLength)
            .attr('y', d => y(d.rank) + barPadding / 2);

        bars.exit()
            .transition()
            .duration(tickDuration)
            .ease(d3.easeLinear)
            .attr('width', d => (x(d.value) - x(0)) + minBarLength)
            .attr('y', d => y(top_n + 1) + barPadding / 2)
            .remove();

        // update labels
        let labels = svg.selectAll('.label').data(row_data, d => d.name);

        let labelsEnter = labels.enter().append('text')
            .attr('class', 'label')
            .attr('x', d => labelX(d))
            .attr('y', d => y(top_n + 1) + ((y(1) - y(0)) / 2))
            .style('text-anchor', 'end')
            .html(d => d.name)
            .transition()
            .duration(tickDuration)
            .ease(d3.easeLinear)
            .attr('y', d => y(d.rank) + ((y(1) - y(0)) / 2) + 1);
        if (labelTextStyle.fontFamily) labelsEnter.style('font-family', labelTextStyle.fontFamily);
        if (labelTextStyle.fontSize) labelsEnter.style('font-size', labelTextStyle.fontSize + 'px');
        if (labelTextStyle.fill) labelsEnter.style('fill', labelTextStyle.fill);

        labels.transition()
            .duration(tickDuration)
            .ease(d3.easeLinear)
            .attr('x', d => labelX(d))
            .attr('y', d => y(d.rank) + ((y(1) - y(0)) / 2) + 1);
        if (labelTextStyle.fontFamily) labels.style('font-family', labelTextStyle.fontFamily);
        if (labelTextStyle.fontSize) labels.style('font-size', labelTextStyle.fontSize + 'px');
        if (labelTextStyle.fill) labels.style('fill', labelTextStyle.fill);

        labels.exit()
            .transition()
            .duration(tickDuration)
            .ease(d3.easeLinear)
            .attr('x', d => labelX(d))
            .attr('y', d => y(top_n + 1)).remove();

        // update icons
        let icons = svg.selectAll('image.icon').data(row_data.filter(d => hasIcon(d)), d => d.name);

        icons.enter()
            .append('image')
            .attr('class', 'icon')
            .attr('width', iconSize)
            .attr('height', iconSize)
            .attr('x', d => iconX(d))
            .attr('y', d => y(top_n + 1) - iconSize / 2)
            .attr('href', d => iconUrlByName[d.name])
            .attr('xlink:href', d => iconUrlByName[d.name])
            .transition()
            .duration(tickDuration)
            .ease(d3.easeLinear)
            .attr('y', d => y(d.rank) + ((y(1) - y(0)) / 2) - iconSize / 2);

        icons.transition()
            .duration(tickDuration)
            .ease(d3.easeLinear)
            .attr('x', d => iconX(d))
            .attr('y', d => y(d.rank) + ((y(1) - y(0)) / 2) - iconSize / 2);

        icons.exit()
            .transition()
            .duration(tickDuration)
            .ease(d3.easeLinear)
            .attr('y', d => y(top_n + 1) - iconSize / 2)
            .remove();

        // update value labels

        let valueLabels = svg.selectAll('.valueLabel').data(row_data, d => d.name);

        let valueEnter = valueLabels
            .enter()
            .append('text')
            .attr('class', 'valueLabel')
            .attr('x', d => valueLabelX(d))
            .attr('y', d => y(top_n + 1))
            .text(d => d3.format(',.0f')(d.lastValue))
            .transition()
            .duration(tickDuration)
            .ease(d3.easeLinear)
            .attr('y', d => y(d.rank) + ((y(1) - y(0)) / 2) + 1);
        if (valueTextStyle.fontFamily) valueEnter.style('font-family', valueTextStyle.fontFamily);
        if (valueTextStyle.fontSize) valueEnter.style('font-size', valueTextStyle.fontSize + 'px');
        if (valueTextStyle.fill) valueEnter.style('fill', valueTextStyle.fill);

        valueLabels
            .transition()
            .duration(tickDuration)
            .ease(d3.easeLinear)
            .attr('x', d => valueLabelX(d))
            .attr('y', d => y(d.rank) + ((y(1) - y(0)) / 2) + 1)
            .tween("text", function (d) {
                let i = d3.interpolateNumber(d.lastValue, d.value);
                return function (t) {
                    this.textContent = d3.format(',.0f')(i(t));
                };
            });
        if (valueTextStyle.fontFamily) valueLabels.style('font-family', valueTextStyle.fontFamily);
        if (valueTextStyle.fontSize) valueLabels.style('font-size', valueTextStyle.fontSize + 'px');
        if (valueTextStyle.fill) valueLabels.style('fill', valueTextStyle.fill);

        // keep value labels on top during updates
        valueLabels.raise();


        valueLabels
            .exit()
            .transition()
            .duration(tickDuration)
            .ease(d3.easeLinear)
            .attr('x', d => valueLabelX(d))
            .attr('y', d => y(top_n + 1)).remove()

        // update time label and progress bar
        d3.select('.progressBar')
            .transition()
            .duration(tickDuration)
            .ease(d3.easeLinear)
            .attr('width', t(time) - marginTimeAxis)
        // .on('end', () => {
        //     d3.select('.timeText').html(d3.timeFormat("%B %d, %Y")(time))
        // timeText.html(d3.timeFormat("%B %d, %Y")(time))
        // })
        timeText.html(d3.timeFormat("%B %d, %Y")(time))
        
        // Update fact display based on current time
        updateFactDisplay(time);

    }

    // loop
    let i = 1;
    let interval = d3.interval((e) => {
        [time, row_data] = getRowData(data, column_names, i);
        drawGraph();
        // increment loop
        i += 1
        if (i == data.length) {
            interval.stop();
            // Call onComplete callback if provided
            if (resolvedOptions.onComplete && typeof resolvedOptions.onComplete === 'function') {
                resolvedOptions.onComplete();
            }
        }


    }, tickDuration)
    return interval


}
