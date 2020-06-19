const EPSILON = 2.2204460492503130808472633361816E-16

const nearlyEqual = function (i, j, epsilon) {
    const iAbsolute= Math.abs(i)
    const jAbsolute = Math.abs(j)
    const difference = Math.abs(i - j)
    let equal = i === j
    if (!equal) {
        equal = difference < EPSILON
        if (!equal) {
            equal = difference <= Math.max(iAbsolute, jAbsolute) * epsilon
        }
    }

    return equal
}

module.exports = {
    EPSILON: EPSILON,
    nearlyEqual: nearlyEqual
}