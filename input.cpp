#include <vector>
#include <cmath>
#include <algorithm>
#include <string>

namespace TSUtil {
    float median(const std::vector<float>& values) {
        if (values.empty())
            return 0.0f;
        
        size_t n = values.size();
        //std::sort(values.begin(), values.end());

        if (n % 2 == 0)
            return (values[n / 2 - 1] + values[n / 2]) / 2.0f;
        else
            return values[n / 2];
    }

    float mad(const std::vector<float>& values) {
        if (values.empty())
            return 0.0f;
        
        float mid = median(values);

        std::vector<float> deviations(values.size());
        
        for (size_t i = 0; i < values.size(); ++i)
            deviations[i] = std::abs(values[i] - mid);
        
        return 1.4826f * median(deviations);
    }

    void variation(const std::vector<float>& origin, std::vector<float>& variance) {
        if (origin.empty())
            return;
        
        if (origin.size() < 2)
            return;

        variance.resize(origin.size() - 1);
        for (size_t i = 0; i < origin.size() - 1; ++i)
            variance[i] = origin[i + 1] - origin[i];
    }

    void speed(const std::vector<float>& origin, const std::vector<float>& time, std::vector<float>& speeds) {
        if (origin.size() != time.size() || origin.empty() || time.empty())
            return;

        speeds.resize(origin.size() - 1);

        for (size_t i = 0; i < origin.size() - 1; ++i) {
            float time_diff = time[i + 1] - time[i];

            if (time_diff == 0.0f)
                speeds[i] = std::numeric_limits<float>::quiet_NaN();
            else
                speeds[i] = (origin[i + 1] - origin[i]) / time_diff;
        }
    }
}

struct TimePoint {
    float time, origin;

    inline bool operator<(const TimePoint& point) const {
        return time < point.time;
    }
};

struct DataQuality {
    float completeness, consistency, timeliness, validity;
};


class TimeSeriesQuality {
private:
    int cnt = 0;
    int missCnt = 0;
    int specialCnt = 0;
    int lateCnt = 0;
    int redundancyCnt = 0;
    int valueCnt = 0;
    int variationCnt = 0;
    int speedCnt = 0;
    int speedchangeCnt = 0;
    std::vector<float> time;
    std::vector<float> origin;
public:
    static const int WINDOW_SIZE = 10;
    bool downtime = true;

    unsigned int toPoints(TimePoint* points) {
        for (unsigned int i = 0; i < time.size(); i++)
            points[i] = {time[i], origin[i]};
        
        return time.size();
    }

    TimeSeriesQuality(std::vector<float>& timeData, std::vector<float>& originData)
    : time(timeData), origin(originData) {
        cnt = time.size();
        specialCnt = 0;
        missCnt = 0;
        lateCnt = 0;
        redundancyCnt = 0;
        valueCnt = 0;
        variationCnt = 0;
        speedCnt = 0;
        speedchangeCnt = 0;

        processNaN();
    }

    void processNaN() {
        size_t n = origin.size();
        size_t index1 = 0;
        size_t index2 = 0;
        
        while (index1 < n && std::isnan(origin[index1])) {
            index1++;
        }

        index2 = index1 + 1;
        
        while (index2 < n && std::isnan(origin[index2])) {
            index2++;
        }
        
        if (index2 >= n) {
            return;
        }

        for (size_t i = 0; i < index2; i++) {
            origin[i] = origin[index1] + (origin[index2] - origin[index1]) * (time[i] - time[index1]) / (time[index2] - time[index1]);
        }

        for (size_t i = index2 + 1; i < n; i++) {
            if (!std::isnan(origin[i])) {
                index1 = index2;
                index2 = i;
                for (size_t j = index1 + 1; j < index2; j++) {
                    origin[j] = origin[index1] + (origin[index2] - origin[index1]) * (time[j] - time[index1]) / (time[index2] - time[index1]);
                }
            }
        }

        for (size_t i = index2 + 1; i < n; i++) {
            origin[i] = origin[index1] + (origin[index2] - origin[index1]) * (time[i] - time[index1]) / (time[index2] - time[index1]);
        }
    }

    void timeDetect() {
        std::vector<float> interval;
        TSUtil::variation(time, interval);

        float base = TSUtil::median(interval);

        std::vector<float> window;
        size_t i = 0;
        for (i = 0; window.size() < WINDOW_SIZE && i < time.size(); i++) {
            window.push_back(time[i]);
        }

        while (window.size() > 1) {
            float times = (window[1] - window[0]) / base;
            if (times <= 0.5f) {
                window.erase(window.begin() + 1);
                redundancyCnt++;
            } else if (times >= 2.0f) {
                size_t temp = 0;
                for (size_t j = 2; j < window.size(); j++) {
                    float times2 = (window[j] - window[j - 1]) / base;
                    if (times2 >= 2.0f) break;
                    if (times2 <= 0.5f) {
                        temp++;
                        window.erase(window.begin() + j);
                        j--;
                        if (temp == static_cast<int>(std::round(times - 1))) break;
                    }
                }
                lateCnt += temp;
                missCnt += (std::round(times - 1) - temp);
            }
            window.erase(window.begin());
            while (window.size() < WINDOW_SIZE && i < time.size()) {
                window.push_back(time[i]);
                i++;
            }
        }
    }

    void valueDetect() {
        int k = 3;
        valueCnt = findOutliers(origin, k);

        std::vector<float> variation;
        TSUtil::variation(origin, variation);
        variationCnt = findOutliers(variation, k);

        std::vector<float> speed;
        TSUtil::speed(origin, time, speed);
        speedCnt = findOutliers(speed, k);

        std::vector<float> speedchange;
        TSUtil::variation(speed, speedchange);
        speedchangeCnt = findOutliers(speedchange, k);
    }

    int findOutliers(const std::vector<float>& values, float k) {
        float mid = TSUtil::median(values);
        float sigma = TSUtil::mad(values);
        int num = 0;
        for (const auto& v : values) {
            if (std::abs(v - mid) > k * sigma) {
                num++;
            }
        }
        return num;
    }

    float getCompleteness() {
        return 1.0f - (missCnt + specialCnt) / (float) (cnt + missCnt);
    }

    float getConsistency() {
        return 1.0f - redundancyCnt / (float) cnt;
    }

    float getTimeliness() {
        return 1.0f - lateCnt / (float) cnt;
    }

    float getValidity() {
        return 1.0f - (valueCnt + variationCnt + speedCnt + speedchangeCnt) * 0.25f / (float) cnt;
    }
};

bool isFloat(const char* str) {
    char* end = nullptr;
    std::strtof(str, &end);
    return end != str && *end == '\0';
}

bool processCsvData(const char* const data,
                    unsigned int dataLength,
                    bool header,
                    char separator,
                    std::vector<TimePoint>& points) {
    const char* start = data;
    const char* end = data + dataLength;

    if (header) {
        while (start < end && *start != '\n') ++start;
        if (start < end) ++start;
    }

    while (start < end) {
        const char* lineEnd = std::find(start, end, '\n');
        const char* line = start;
        start = lineEnd < end ? lineEnd + 1 : end;


        const char* col1 = line;
        const char* col1End = std::find(line, lineEnd, separator);
        if (col1End == lineEnd) return false;

        const char* col2 = col1End + 1;
        const char* col2End = std::find(col2, lineEnd, separator);

        if (col2End != lineEnd) return false;

        std::string value1(col1, col1End - col1);
        std::string value2(col2, lineEnd - col2);

        if (!isFloat(value1.c_str()) || !isFloat(value2.c_str()))
            return false;

        float time = std::strtof(value1.c_str(), nullptr);
        float origin = std::strtof(value2.c_str(), nullptr);

        points.push_back({time, origin});
    }

    return true;
}

extern "C" unsigned int process(const char* const data,
            unsigned int dataLength,
            bool header,
            char separator,
            DataQuality* quality,
            TimePoint* resPoints, TimePoint* originalPoints) {
    std::vector<TimePoint> points;

    if (!processCsvData(data, dataLength, header, separator, points)) {
        return 0;
    }

    std::sort(points.begin(), points.end());

    std::vector<float> time(points.size(), 0.0f);
    std::vector<float> origin(points.size(), 0.0f);

    for (unsigned int i = 0; i < points.size(); i++) {
        time[i] = points[i].time;
        origin[i] = points[i].origin;
    }
    
    TimeSeriesQuality timeSeries{time, origin};

    timeSeries.timeDetect();

    quality->completeness = timeSeries.getCompleteness();
    quality->consistency = timeSeries.getConsistency();
    quality->validity = timeSeries.getValidity();
    quality->timeliness = timeSeries.getTimeliness();

    unsigned int pointsSize = timeSeries.toPoints(resPoints);

    for (size_t i = 0; i < points.size(); i++)
        originalPoints[i] = points[i];
    
    return pointsSize;
}