(ns tres-game)

(use '[utils :only (process-move)])
(use '[data :only (board)])

(defn play [board]
  (loop [board board]
    (if (game-over? board)
      (println (str "Game over!" "Winner is" (winner board)))
      (let [team-one-moves (get-moves)
            team-two-moves (get-moves)]
        (recur (reduce update-board board (partition 2 (interleave team-one-moves team-two-moves))))))))

;; (play board)
