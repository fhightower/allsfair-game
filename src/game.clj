(ns game)

(use '[utils :only (get-moves get-winner make-moves)])
(use '[data :only (board)])

(defn play [board]
  (loop [board board]
    (if (some? (get-winner board))
      (println (str "Game over!" "Winner is" (get-winner board)))
      (let [team-one-moves (get-moves)
            team-two-moves (get-moves)]
        (recur (reduce make-moves board (partition 2 (interleave team-one-moves team-two-moves))))))))

;; (play board)
