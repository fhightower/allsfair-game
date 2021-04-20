(ns tres-game)

(defn pow [x n]
  (reduce * (repeat (int n) (int x))))

(defn digits [n]
  (loop [num n
         d ()]
    (if (zero? num)
      d
      (recur (quot num 10) (conj d (mod num 10))))))

(defn armstrong-function [num]
  (apply + 
    (let [len (count (str num))]
      (map #(pow % len) (digits num)))))

(defn armstrong? [num]
  (= (armstrong-function num) num))
