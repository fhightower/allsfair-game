(ns squarular.utils)

(defn add-x-n-times [l x n]
  (loop [l l
         i 0]
    (if (= i n)
      l
      (recur (conj l x) (inc i)))))
