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

    const analyseFile = (dataSet, separator, header) => {
        const csvData = dataSet.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, 
            (match, year, month, day) => new Date(`${year}-${month}-${day}`).getTime().toString())
            .toString();

        const dataLength = csvData.length;
    
        const ptrData = malloc(dataLength);
        const csvMemory = new Uint8Array(memory.buffer, ptrData, dataLength);
    
        let counter = 0;
        let counterSep = 0;
        let maxSeparators = 0;
    
        for (let i = 0; i < dataLength; i++) {
            if (csvData.charCodeAt(i) !== 13) {
                csvMemory[i] = csvData.charCodeAt(i);
            } else {
                counter++;
            }

            if (csvData.charCodeAt(i) === separator) {
                counterSep++;
            }

            if (csvData[i] === '\n' || i === dataLength - 1) {
                maxSeparators = Math.max(maxSeparators, counterSep);
                counterSep = 0;
            }
        }

        const TPSize = counter * maxSeparators;

        const ptrQuality = malloc(16 * maxSeparators);
        const ptrTSOrigin = malloc(16 * maxSeparators);
        const ptrOriginPoints = malloc(TPSize * 8);
        const ptrCorrPoints = malloc(TPSize * 8);

        if (!process(ptrData, dataLength - 1, header, separator, ptrQuality, ptrTSOrigin,
            ptrOriginPoints, ptrCorrPoints)) {
            console.log("bad data");
            
            free(ptrData);
            free(ptrQuality);
            free(ptrTSOrigin);
            free(ptrOriginPoints);
            free(ptrCorrPoints);
            return null;
        }

        const quality = new Float32Array(memory.buffer, ptrQuality, 4 * maxSeparators);
        const TSOrigin = new Float32Array(memory.buffer, ptrTSOrigin, 4 * maxSeparators);

        const originsPoints = new Float32Array(memory.buffer, ptrOriginPoints, TPSize * 2);
        const corrPoints = new Float32Array(memory.buffer, ptrOriginPoints, TPSize * 2);

        const qualitys = Array.from(
            new Array(maxSeparators), 
            (v, i) => {return {
                completeness: quality[i * 4],
                consistency: quality[i * 4 + 1],
                timeliness: quality[i * 4 + 2],
                validity: quality[i * 4 + 3],
                values : {
                    completeness: TSOrigin[i * 4],
                    consistency: TSOrigin[i * 4 + 1],
                    timeliness: TSOrigin[i * 4 + 2],
                    validity: TSOrigin[i * 4 + 3],
                },
                origins: Array.from(new Array(counter), 
                (_, j) => {return {time: originsPoints[(i * counter + j) * 2], origin: originsPoints[(i * counter + j) * 2 + 1]}}),
                corrPoints: Array.from(new Array(counter), 
                (_, j) => {return {time: corrPoints[(i * counter + j) * 2], origin: corrPoints[(i * counter + j) * 2 + 1]}})
            }});

        free(ptrData);
        free(ptrQuality);
        free(ptrTSOrigin);
        free(ptrOriginPoints);
        free(ptrCorrPoints);

        return qualitys;
    };

    const fileInput = document.getElementById('fileInput');
    const global = document.getElementById('global');

    fileInput.onchange = () => {        
        const files = Array.from(fileInput.files).filter(file => file.name.endsWith('.csv'));
        if (!files.length) {
            alert("1 or more csv needed");
            return;
        }

        const promises = [];

        for (let i = 0; i < files.length; i++) {
            const promise = new Promise((resolve, reject) => {
                const reader = new FileReader();
                
                reader.onload = (res) => {
                    const qualitys = analyseFile(res.target.result, ','.charCodeAt(0), true);
    
                    if (!qualitys) {
                        alert("bad data");
                        return;
                    }

                    return resolve(Array.from(qualitys, (quality) => {return {
                        completeness: quality.completeness,
                        consistency: quality.consistency,
                        timeliness: quality.timeliness,
                        validity: quality.validity,
                        values: quality.values,
                        origins: quality.origins,
                        corrPoints: quality.corrPoints,
                        name: files[i].name
                    }}));
                };
                
                reader.readAsText(files[i]);
            });

            promises.push(promise);
        }

        Promise.all(promises)
        .then((results) => {
            let data = results.flat();

            global.innerHTML = Array.from(data, file => `<div class="file-name"><h1>${file.name}</h1></div>
                <div class="chart-container">
                    <canvas class="barChart"></canvas>
                    <canvas class="lineChart"></canvas>
                </div>`).join('');
            
            const charts = document.querySelectorAll(".chart-container");
        
            for (let i = 0; i < data.length; i++) {
                setGraphs(charts[i].querySelector('.barChart'),
                    charts[i].querySelector('.lineChart'),
                    [
                        {name: "Completeness", value: data[i].completeness},
                        {name: "Consistency", value: data[i].consistency},
                        {name: "Timeliness", value: data[i].timeliness},
                        {name: "Validity", value: data[i].values.validity}
                    ], {
                        origins: data[i].origins,
                        times: data[i].corrPoints,
                    });
            }
        })
        .catch((error) => {
            console.error("Error reading files:", error);
        });
    };
};