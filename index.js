function setGraphs(barChart, lineChart, barData, lineData) {
    const barCtx = barChart.getContext('2d');
    new Chart(barCtx, {
        type: 'bar',
        data: {
            labels: Array.from(barData, d => d.name),
            datasets: [
                {
                    label: 'Data Quality',
                    data: Array.from(barData, d => d.value),
                    backgroundColor: [
                        'rgba(255, 99, 132, 1)',
                        'rgba(54, 162, 235, 1)',
                        'rgba(255, 206, 86, 1)',
                        'rgba(75, 192, 192, 1)'],
                    borderColor: 'rgba(128, 128, 132, 1)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            scales: {
                y: {
                    beginAtZero: true
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
    
    // Line Chart 1
    const lineCtx = lineChart.getContext('2d');
    new Chart(lineCtx, {
        type: 'line',
        data: {
            labels: Array.from(lineData.origins, (origin, _) => `${origin.time}`),
            datasets: [
                {
                    label: 'original',
                    data: Array.from(lineData.origins, (origin, _) => `${origin.origin}`),
                    borderColor: 'rgba(54, 162, 235, 1)',
                    backgroundColor: 'rgba(54, 162, 235, 0.1)',
                    borderWidth: 2,
                    tension: 0
                },
                {
                    label: 'new_values',
                    data: Array.from(lineData.times, (origin, _) => `${origin.origin}`),
                    borderColor: 'rgba(235, 54, 162, 1)',
                    backgroundColor: 'rgba(235, 54, 162, 0.1)',
                    borderWidth: 2,
                    tension: 0
                }
            ]
        },
        options: {
            scales: {
                y: {
                    beginAtZero: true
                }
            },
            plugins: {
                legend: {
                    display: true
                }
            }
        }
    });
}

onload = async () => {
    const {free, malloc, memory, process} = (await WebAssembly.instantiate(await (await fetch('output.wasm')).arrayBuffer())).instance.exports;

    const ptrNull = malloc(1);

    console.log(ptrNull);

    free(ptrNull);

    const analyseFile = (csvData, separator, header) => {
        const dataLength = csvData.length;
    
        let ptrData = malloc(dataLength);
        const csvMemory = new Uint8Array(memory.buffer, ptrData, dataLength);
    
        let counter = 0;
    
        for (let i = 0; i < dataLength; i++) {
            if (csvData.charCodeAt(i) !== 13) {
                csvMemory[i] = csvData.charCodeAt(i);
            } else {
                counter++;
            }
        }
    
        /*console.log(csvData);
        console.log(Array.from(csvMemory, d => String.fromCharCode(d)).join(''));*/

        let ptrQuality = malloc(16);
        let resPointsPtr = malloc(counter * 8);
        let originalPointsPtr = malloc(counter * 8);

        console.log(ptrData, ptrQuality, resPointsPtr, originalPointsPtr);
    
        const resPointsLength = process(ptrData, dataLength, header, separator, ptrQuality, resPointsPtr, originalPointsPtr);
    
        const quality = new Float32Array(memory.buffer, ptrQuality, 4);
        const dataQuality = {
            completeness: quality[0], 
            consistency: quality[1], 
            timeliness: quality[2], 
            validity: quality[3]
        };
    
        const resPointsArray = new Float32Array(memory.buffer, resPointsPtr, resPointsLength * 2);
        const originalPointsArray = new Float32Array(memory.buffer, originalPointsPtr, resPointsLength * 2);
    
        const origins = [];
        const times = [];
    
        for (let i = 0; i < resPointsLength; i++) {
            origins.push({ time: originalPointsArray[i * 2], origin: originalPointsArray[i * 2 + 1] });
    
            const time = resPointsArray[i * 2];
            const origin = resPointsArray[i * 2 + 1];
            times.push({ time, origin });
        }
    
        free(ptrData);
        free(ptrQuality);
        free(resPointsPtr);
        free(originalPointsPtr);

        ptrData = 0;
        ptrQuality = 0;
        resPointsPtr = 0;
        originalPointsPtr = 0;

        console.log(ptrData, ptrQuality, resPointsPtr, originalPointsPtr);
    
        return { origins, times, dataQuality };
    };    

    const fileInput = document.getElementById('fileInput');
    const global = document.getElementById('global');

    fileInput.onchange = () => {        
        const files = Array.from(fileInput.files).filter(file => file.name.endsWith('.csv'));
        if (!files.length) {
            alert("1 or more csv needed");
            return;
        }

        global.innerHTML = `<h1 id="time_taken">time taken : </h1>` + Array.from(files, file => `<div class="file-name"><h1>${file.name}</h1></div>
        <div class="chart-container">
            <canvas class="barChart"></canvas>
            <canvas class="lineChart"></canvas>
        </div>`).join('');

        const charts = document.querySelectorAll(".chart-container");

        const reader = new FileReader();

        for (let i = 0; i < charts.length; i++) {
            reader.onload = (res) => {
                const t1 = performance.now();

                const {origins, times, dataQuality} = analyseFile(res.target.result, ','.charCodeAt(0), true);
                
                const t2 = performance.now();
                
                document.getElementById("time_taken").innerText = `time taken : ${t2 - t1} ms`;

                if (!origins.length) {
                    alert("bad data");
                    return;
                }                
                
                setGraphs(charts[i].querySelector('.barChart'), charts[i].querySelector('.lineChart'),
                            [
                                {name: "Completeness", value: dataQuality.completeness},
                                {name: "Consistency", value: dataQuality.consistency},
                                {name: "Timeliness", value: dataQuality.timeliness},
                                {name: "Validity", value: dataQuality.validity}
                            ], {
                                origins,
                                times,
                            });
                
                const t3 = performance.now();
                
                document.getElementById("time_taken").innerText = `time taken : ${t2 - t1} ms (${t3 - t1})`;
            };
            
            reader.readAsText(fileInput.files[i]);
        }        
    };
};
